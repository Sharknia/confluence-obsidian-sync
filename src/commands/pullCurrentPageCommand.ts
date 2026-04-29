import {
  getMissingConfluenceConnectionFields,
  type RequiredConfluenceConnectionField
} from "../confluence/authentication";
import { fetchConfluencePageForPull, type ConfluencePagePullResult } from "../confluence/pageUpdate";
import { buildConfluencePageViewUrl } from "../confluence/pageUrl";
import { convertConfluenceStorageToMarkdown } from "../markdown/confluenceStorageToMarkdown";
import {
  calculateMarkdownBodyHash,
  createCurrentPageBackupPath,
  createDetachedPageBackupMarkdown,
  createPageMarkdownContent,
  parsePageMarkdownMetadata
} from "../projects/pageMarkdown";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export interface ActiveMarkdownFile {
  path: string;
}

export type PullCurrentPageFetcher = (
  settings: ConfluenceSyncSettings,
  pageId: string
) => Promise<ConfluencePagePullResult>;

export interface RunPullCurrentPageCommandInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  getActiveMarkdownFile: () => ActiveMarkdownFile | null;
  fetchPage?: PullCurrentPageFetcher;
  now?: () => Date;
  confirmOverwriteLocalChanges?: (message: string) => boolean;
  showNotice: (message: string) => void;
}

const defaultPullCurrentPageFetcher: PullCurrentPageFetcher = async (settings, pageId) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return fetchConfluencePageForPull(settings, pageId, createObsidianRequestTransport);
};

export async function runPullCurrentPageCommand({
  settings,
  storage,
  getActiveMarkdownFile,
  fetchPage = defaultPullCurrentPageFetcher,
  now = () => new Date(),
  confirmOverwriteLocalChanges,
  showNotice
}: RunPullCurrentPageCommandInput): Promise<void> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    showNotice(
      `Pull Current Page 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields
        .map(toSettingsFieldName)
        .join(", ")}`
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
    showNotice("Confluence metadata가 있는 Markdown 파일만 Pull할 수 있습니다.");
    return;
  }

  if (metadata.versionNumber === null || metadata.contentHash === null) {
    showNotice("confluenceVersion과 confluenceContentHash가 있어야 Pull Current Page를 실행할 수 있습니다.");
    return;
  }

  const remotePageResult = await fetchPage(settings, metadata.pageId);

  if (!remotePageResult.ok) {
    showNotice(remotePageResult.message);
    return;
  }

  const markdownConversion = convertConfluenceStorageToMarkdown(remotePageResult.page.bodyStorageValue);
  const remoteBodyMarkdown = `${markdownConversion.markdown}\n`;
  const remoteContent = createPageMarkdownContent({
    pageId: remotePageResult.page.pageId,
    title: remotePageResult.page.title,
    versionNumber: remotePageResult.page.versionNumber,
    sourceUrl: buildConfluencePageViewUrl(settings.confluenceBaseUrl, remotePageResult.page.pageId),
    parentId: remotePageResult.page.parentId,
    bodyMarkdown: remoteBodyMarkdown
  });
  let backupPath: string | null;
  const hasLocalChanges = calculateMarkdownBodyHash(metadata.bodyMarkdown) !== metadata.contentHash;

  if (hasLocalChanges) {
    const shouldContinue =
      confirmOverwriteLocalChanges?.(
        [
          "현재 파일에 로컬 수정사항이 있습니다. 연결이 해제된 백업본을 만든 뒤 현재 파일을 원격 본문으로 덮어씁니다.",
          "",
          `파일: ${activeFile.path}`,
          `pageId: ${metadata.pageId}`,
          `원격 version: ${remotePageResult.page.versionNumber}`,
          "",
          "계속하시겠습니까?"
        ].join("\n")
      ) ?? true;

    if (!shouldContinue) {
      showNotice("Pull Current Page를 취소했습니다.");
      return;
    }
  }

  try {
    backupPath = await maybeCreateDetachedBackup({
      storage,
      originalPath: activeFile.path,
      originalContent,
      hasLocalChanges,
      now: now()
    });
    await storage.write(activeFile.path, remoteContent);
  } catch {
    showNotice("Pull Current Page 결과를 로컬 파일에 적용할 수 없습니다.");
    return;
  }

  showNotice(
    backupPath === null
      ? `Pull Current Page 완료: Confluence version ${remotePageResult.page.versionNumber}, 백업 없음`
      : `Pull Current Page 완료: Confluence version ${remotePageResult.page.versionNumber}, 백업 생성 ${backupPath}`
  );
}

async function maybeCreateDetachedBackup(input: {
  storage: ProjectStorageAdapter;
  originalPath: string;
  originalContent: string;
  hasLocalChanges: boolean;
  now: Date;
}): Promise<string | null> {
  if (!input.hasLocalChanges) {
    return null;
  }

  for (let collisionIndex = 0; collisionIndex < 100; collisionIndex += 1) {
    const backupPath = createCurrentPageBackupPath(input.originalPath, input.now, collisionIndex);

    if (await input.storage.exists(backupPath)) {
      continue;
    }

    await input.storage.write(backupPath, createDetachedPageBackupMarkdown(input.originalContent));

    return backupPath;
  }

  throw new Error("백업 파일 경로를 만들 수 없습니다.");
}

function toSettingsFieldName(field: RequiredConfluenceConnectionField): string {
  return field === "API token" ? "apiToken" : field;
}
