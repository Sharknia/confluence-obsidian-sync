import { finishCommand, type CommandResult } from "./commandResult";
import { requireRequestTransport, type ConfluenceRequestTransport } from "../confluence/requestTransport";
import { StorageGuardError } from "../projects/storageFailure";
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
  hasVerifiedMarkdownSource,
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
  transport?: ConfluenceRequestTransport;
  verifySource?: boolean;
  getActiveMarkdownFile: () => ActiveMarkdownFile | null;
  fetchPage?: PushPageFetcher;
  updatePage?: PushPageUpdater;
  confirmPush?: (message: string) => boolean;
  showNotice: (message: string) => void;
}

export async function runPushCurrentPageCommand({
  settings,
  storage,
  getActiveMarkdownFile,
  transport,
  verifySource = false,
  fetchPage = (settings, pageId) => fetchConfluencePageForPush(settings, pageId, requireRequestTransport(transport)),
  updatePage = (settings, input) => updateConfluencePageBody(settings, input, requireRequestTransport(transport)),
  confirmPush,
  showNotice,
}: RunPushCurrentPageCommandInput): Promise<CommandResult> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    return finishCommand(showNotice, "error", "missing-settings",
      `Push 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields
        .map(toSettingsFieldName)
        .join(", ")}`,
    );
  }

  const activeFile = getActiveMarkdownFile();

  if (activeFile === null) {
    return finishCommand(showNotice, "error", "missing-file", "현재 열린 Markdown 파일이 없습니다.");
  }

  let originalContent: string;

  try {
    originalContent = await storage.read(activeFile.path);
  } catch {
    return finishCommand(showNotice, "error", "file-read-failed", "현재 Markdown 파일을 읽을 수 없습니다.");
  }

  const metadata = parsePageMarkdownMetadata(originalContent);

  if (metadata === null) {
    return finishCommand(showNotice, "blocked", "missing-metadata", "Confluence pageId가 있는 Markdown 파일만 Push할 수 있습니다.");
  }

  if (metadata.versionNumber === null) {
    return finishCommand(showNotice, "blocked", "missing-version", "confluenceVersion이 없어 Push할 수 없습니다. 먼저 Pull Tree를 실행하세요.");
  }

  if (verifySource && !hasVerifiedMarkdownSource(originalContent, settings.confluenceBaseUrl)) {
    return finishCommand(showNotice, "blocked", "source-not-verified", "문서의 Confluence 출처와 pageId를 확인할 수 없습니다. 해당 사이트의 Pull Tree 산출물을 사용하세요.");
  }

  const remotePageResult = await fetchPage(settings, metadata.pageId);

  if (!remotePageResult.ok) {
    return finishCommand(showNotice, "error", remotePageResult.reason, remotePageResult.message);
  }

  if (remotePageResult.page.versionNumber !== metadata.versionNumber) {
    return finishCommand(showNotice, "blocked", "version-conflict",
      `Push 차단: 원격 version ${remotePageResult.page.versionNumber}, 로컬 version ${metadata.versionNumber}. Pull Tree 후 다시 시도하세요.`,
    );
  }

  if (metadata.contentHash !== null && calculateMarkdownBodyHash(metadata.bodyMarkdown) === metadata.contentHash) {
    return finishCommand(showNotice, "unchanged", "no-changes", "Push할 변경사항이 없습니다. 로컬 본문이 마지막 동기화 상태와 같습니다.");
  }

  const conversionResult = convertMarkdownToConfluenceStorage(metadata.bodyMarkdown);

  if (!conversionResult.ok) {
    return finishCommand(showNotice, "blocked", "conversion-failed", conversionResult.message);
  }

  const nextVersionNumber = remotePageResult.page.versionNumber + 1;
  const shouldContinue =
    confirmPush?.(
      [
        "현재 Markdown 문서를 Confluence 페이지에 업로드합니다.",
        "",
        `pageId: ${metadata.pageId}`,
        `제목: ${remotePageResult.page.title}`,
        `현재 version: ${remotePageResult.page.versionNumber}`,
        `업로드 후 version: ${nextVersionNumber}`,
        "",
        "계속하시겠습니까?",
      ].join("\n"),
    ) ?? true;

  if (!shouldContinue) {
    return finishCommand(showNotice, "blocked", "confirmation-required", "Push를 취소했습니다.", {
      remoteState: "not-applied",
      confirmation: { filePath: activeFile.path, pageId: metadata.pageId, title: remotePageResult.page.title,
        remoteVersion: remotePageResult.page.versionNumber, nextVersion: nextVersionNumber }
    });
  }

  try {
    await storage.assertUnchanged?.(activeFile.path);
    if (await storage.read(activeFile.path) !== originalContent) throw new StorageGuardError("local-changed", activeFile.path);
  } catch (error) {
    return finishCommand(showNotice, "blocked", error instanceof StorageGuardError ? error.reason : "file-read-failed", "Push 확인 중 로컬 파일이 변경되었거나 읽을 수 없어 업로드를 차단했습니다.", { remoteState: "not-applied" });
  }

  const updateResult = await updatePage(settings, {
    pageId: metadata.pageId,
    title: remotePageResult.page.title,
    nextVersionNumber,
    bodyStorageValue: conversionResult.storageValue,
  });

  if (!updateResult.ok) {
    const remoteState = updateResult.remoteState ?? "not-applied";
    const message = remoteState === "unknown"
      ? "Push 응답을 확인하지 못해 원격 반영 여부가 불명입니다. 재업로드하지 말고 원격 version과 본문을 확인하세요."
      : updateResult.message;
    return finishCommand(showNotice, remoteState === "unknown" ? "unknown" : remoteState === "applied" ? "partial" : "error",
      updateResult.reason, message, { remoteState, localUpdated: false, expectedVersion: nextVersionNumber,
        pageId: metadata.pageId, filePath: activeFile.path });
  }

  const updatedMarkdown = updatePageMarkdownFrontmatterAfterPush(originalContent, {
    versionNumber: updateResult.page.versionNumber,
    contentHash: calculateMarkdownBodyHash(metadata.bodyMarkdown),
  });

  if (updatedMarkdown === null) {
    return finishCommand(showNotice, "partial", "local-metadata-update-failed", "Confluence에는 업로드됐지만 로컬 frontmatter를 갱신하지 못했습니다. Pull Tree로 version을 다시 맞추세요.", { remoteState: "applied", localUpdated: false, versionNumber: updateResult.page.versionNumber });
  }

  try {
    await storage.write(activeFile.path, updatedMarkdown);
  } catch (error) {
    return finishCommand(showNotice, "partial", error instanceof StorageGuardError ? error.reason : "local-metadata-update-failed",
      "Confluence에는 업로드됐지만 로컬 frontmatter를 갱신하지 못했습니다. Pull Tree로 version을 다시 맞추세요.", { remoteState: "applied", localUpdated: false, versionNumber: updateResult.page.versionNumber });
  }

  return finishCommand(showNotice, "success", "pushed", `Push 완료: Confluence version ${updateResult.page.versionNumber}`, { remoteState: "applied", localUpdated: true, versionNumber: updateResult.page.versionNumber });
}

function toSettingsFieldName(field: RequiredConfluenceConnectionField): string {
  return field === "API token" ? "apiToken" : field;
}
