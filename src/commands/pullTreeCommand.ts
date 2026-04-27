import { getMissingConfluenceConnectionFields, type RequiredConfluenceConnectionField } from "../confluence/authentication";
import {
  fetchConfluenceRootContentTree,
  type ConfluenceRootContentTreeResult,
  type ConfluenceRootContentType
} from "../confluence/pageTree";
import { buildPageMarkdownFiles, parsePageMarkdownMetadata } from "../projects/pageMarkdown";
import { createPullSyncPlan } from "../projects/pullSyncPolicy";
import {
  applyPullSyncPlan,
  listProjectMarkdownFiles,
  type ProjectStorageAdapter,
  type PullSyncApplyResult
} from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export type PullTreeFetcher = (
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string
) => Promise<ConfluenceRootContentTreeResult>;

export interface RunPullTreeCommandInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  fetchTree?: PullTreeFetcher;
  showNotice: (message: string) => void;
}

const defaultPullTreeFetcher: PullTreeFetcher = async (settings, rootContentType, rootContentId) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return fetchConfluenceRootContentTree(settings, rootContentType, rootContentId, createObsidianRequestTransport);
};

export async function runPullTreeCommand({
  settings,
  storage,
  fetchTree = defaultPullTreeFetcher,
  showNotice
}: RunPullTreeCommandInput): Promise<void> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    showNotice(
      `Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields
        .map(toSettingsFieldName)
        .join(", ")}`
    );
    return;
  }

  const currentProject = settings.currentProject;

  if (currentProject === null) {
    showNotice("Pull Tree 실행 전에 설정 화면에서 루트 콘텐츠 기반 프로젝트를 생성하세요.");
    return;
  }

  try {
    const result = await fetchTree(settings, currentProject.rootContentType, currentProject.rootContentId);

    if (!result.ok) {
      showNotice(result.message);
      return;
    }

    let markdownFiles: Awaited<ReturnType<typeof buildPageMarkdownFiles>>;
    let writeResult: PullSyncApplyResult;
    let syncPlan: ReturnType<typeof createPullSyncPlan>;

    try {
      const safeDeleteRootPath = buildSafeDeleteRootPath(
        currentProject.localFolderPath,
        settings.safeDeleteFolder,
        new Date()
      );
      const localMarkdownFiles = await listProjectMarkdownFiles(
        storage,
        currentProject.localFolderPath,
        removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath)
      );

      if (!localMarkdownFiles.ok) {
        showNotice(localMarkdownFiles.message);
        return;
      }

      markdownFiles = await buildPageMarkdownFiles({
        projectRootPath: currentProject.localFolderPath,
        root: result.root,
        pages: result.pages,
        existingPagePathById: buildExistingPagePathById(localMarkdownFiles.files),
        pathExists: (path) => storage.exists(path),
        readExistingFile: (path) => storage.read(path)
      });

      syncPlan = createPullSyncPlan({
        projectRootPath: currentProject.localFolderPath,
        safeDeleteRootPath,
        remoteFiles: markdownFiles,
        localFiles: localMarkdownFiles.files
      });
      writeResult = await applyPullSyncPlan(storage, syncPlan);
    } catch {
      showNotice("Markdown 파일을 저장할 수 없습니다.");
      return;
    }

    if (!writeResult.ok) {
      showNotice("Pull 결과를 로컬 파일에 적용할 수 없습니다.");
      return;
    }

    const createCount = syncPlan.filesToWrite.filter((file) => file.operation === "create").length;
    const updateCount = syncPlan.filesToWrite.filter((file) => file.operation === "update").length;
    const conversionWarningCount = markdownFiles.reduce((count, file) => count + file.warnings.length, 0);
    showNotice(
      `Pull 완료: 추가 ${createCount}개, 갱신 ${updateCount}개, 안전 삭제 ${writeResult.safeDeletedFileCount}개, 로컬 수정 스킵 ${writeResult.skippedLocalChangeCount}개, 변경 없음 ${writeResult.unchangedFileCount}개${buildSuccessNoticeSuffix(
        result.errors.length,
        conversionWarningCount
      )}`
    );
  } catch (error) {
    console.error("Pull Tree 실행 중 예기치 못한 오류가 발생했습니다.", error);

    const message = error instanceof Error ? error.message : "Confluence 페이지 트리 조회 중 알 수 없는 오류가 발생했습니다.";
    showNotice(message);
  }
}

function buildSuccessNoticeSuffix(fetchFailureCount: number, conversionWarningCount: number): string {
  const suffixes: string[] = [];

  if (fetchFailureCount > 0) {
    suffixes.push(`조회 실패 ${fetchFailureCount}개`);
  }

  if (conversionWarningCount > 0) {
    suffixes.push(`변환 경고 ${conversionWarningCount}개`);
  }

  return suffixes.length > 0 ? `, ${suffixes.join(", ")}` : "";
}

function toSettingsFieldName(field: RequiredConfluenceConnectionField): string {
  return field === "API token" ? "apiToken" : field;
}

function buildSafeDeleteRootPath(projectRootPath: string, safeDeleteFolder: string, now: Date): string {
  return joinVaultPath(projectRootPath, normalizeSafeDeleteFolder(safeDeleteFolder), createTimestampFolderName(now));
}

function removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath: string): string {
  const pathSegments = safeDeleteRootPath.split("/");

  return pathSegments.slice(0, -1).join("/");
}

function normalizeSafeDeleteFolder(safeDeleteFolder: string): string {
  const normalizedFolder = safeDeleteFolder.trim().replace(/^\/+|\/+$/gu, "");

  return normalizedFolder.length > 0 ? normalizedFolder : ".confluence-sync/trash";
}

function createTimestampFolderName(now: Date): string {
  return now.toISOString().replace(/[:.]/gu, "-");
}

function joinVaultPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}

function buildExistingPagePathById(localMarkdownFiles: Array<{ vaultPath: string; content: string }>): Map<string, string> {
  const existingPagePathById = new Map<string, string>();

  for (const localFile of localMarkdownFiles) {
    const metadata = parsePageMarkdownMetadata(localFile.content);

    if (metadata === null || existingPagePathById.has(metadata.pageId)) {
      continue;
    }

    existingPagePathById.set(metadata.pageId, localFile.vaultPath);
  }

  return existingPagePathById;
}
