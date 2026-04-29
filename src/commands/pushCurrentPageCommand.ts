import {
  getMissingConfluenceConnectionFields,
  type RequiredConfluenceConnectionField,
} from "../confluence/authentication";
import {
  fetchConfluencePageForPush,
  updateConfluencePageBody,
  type ConfluencePagePushResult,
  type UpdateConfluencePageBodyInput,
} from "../confluence/pageUpdate";
import { convertMarkdownToConfluenceStorage } from "../markdown/markdownToConfluenceStorage";
import {
  calculateMarkdownBodyHash,
  parsePageMarkdownMetadata,
  updatePageMarkdownFrontmatterAfterPush,
} from "../projects/pageMarkdown";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export interface ActiveMarkdownFile {
  path: string;
}

export type PushPageFetcher = (
  settings: ConfluenceSyncSettings,
  pageId: string,
) => Promise<ConfluencePagePushResult>;

export type PushPageUpdater = (
  settings: ConfluenceSyncSettings,
  input: UpdateConfluencePageBodyInput,
) => Promise<ConfluencePagePushResult>;

export interface RunPushCurrentPageCommandInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  getActiveMarkdownFile: () => ActiveMarkdownFile | null;
  fetchPage?: PushPageFetcher;
  updatePage?: PushPageUpdater;
  showNotice: (message: string) => void;
}

const defaultPushPageFetcher: PushPageFetcher = async (settings, pageId) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return fetchConfluencePageForPush(settings, pageId, createObsidianRequestTransport);
};

const defaultPushPageUpdater: PushPageUpdater = async (settings, input) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return updateConfluencePageBody(settings, input, createObsidianRequestTransport);
};

export async function runPushCurrentPageCommand({
  settings,
  storage,
  getActiveMarkdownFile,
  fetchPage = defaultPushPageFetcher,
  updatePage = defaultPushPageUpdater,
  showNotice,
}: RunPushCurrentPageCommandInput): Promise<void> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    showNotice(
      `Push 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields
        .map(toSettingsFieldName)
        .join(", ")}`,
    );
    return;
  }

  const activeFile = getActiveMarkdownFile();

  if (activeFile === null) {
    showNotice("현재 열린 Markdown 파일이 없습니다.");
    return;
  }

  let originalContent: string;

  try {
    originalContent = await storage.read(activeFile.path);
  } catch {
    showNotice("현재 Markdown 파일을 읽을 수 없습니다.");
    return;
  }

  const metadata = parsePageMarkdownMetadata(originalContent);

  if (metadata === null) {
    showNotice("Confluence pageId가 있는 Markdown 파일만 Push할 수 있습니다.");
    return;
  }

  if (metadata.versionNumber === null) {
    showNotice("confluenceVersion이 없어 Push할 수 없습니다. 먼저 Pull Tree를 실행하세요.");
    return;
  }

  const remotePageResult = await fetchPage(settings, metadata.pageId);

  if (!remotePageResult.ok) {
    showNotice(remotePageResult.message);
    return;
  }

  if (remotePageResult.page.versionNumber !== metadata.versionNumber) {
    showNotice(
      `Push 차단: 원격 version ${remotePageResult.page.versionNumber}, 로컬 version ${metadata.versionNumber}. Pull Tree 후 다시 시도하세요.`,
    );
    return;
  }

  const conversionResult = convertMarkdownToConfluenceStorage(metadata.bodyMarkdown);

  if (!conversionResult.ok) {
    showNotice(conversionResult.message);
    return;
  }

  const updateResult = await updatePage(settings, {
    pageId: metadata.pageId,
    title: remotePageResult.page.title,
    nextVersionNumber: remotePageResult.page.versionNumber + 1,
    bodyStorageValue: conversionResult.storageValue,
  });

  if (!updateResult.ok) {
    showNotice(updateResult.message);
    return;
  }

  const updatedMarkdown = updatePageMarkdownFrontmatterAfterPush(originalContent, {
    versionNumber: updateResult.page.versionNumber,
    contentHash: calculateMarkdownBodyHash(metadata.bodyMarkdown),
  });

  if (updatedMarkdown === null) {
    showNotice("Confluence에는 업로드됐지만 로컬 frontmatter를 갱신하지 못했습니다. Pull Tree로 version을 다시 맞추세요.");
    return;
  }

  try {
    await storage.write(activeFile.path, updatedMarkdown);
  } catch {
    showNotice("Confluence에는 업로드됐지만 로컬 frontmatter를 갱신하지 못했습니다. Pull Tree로 version을 다시 맞추세요.");
    return;
  }

  showNotice(`Push 완료: Confluence version ${updateResult.page.versionNumber}`);
}

function toSettingsFieldName(field: RequiredConfluenceConnectionField): string {
  return field === "API token" ? "apiToken" : field;
}
