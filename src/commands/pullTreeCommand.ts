import { getMissingConfluenceConnectionFields, type RequiredConfluenceConnectionField } from "../confluence/authentication";
import {
  fetchConfluenceRootContentTree,
  type ConfluencePageTreeError,
  type ConfluenceRootContentTreeResult,
  type ConfluenceRootContentType
} from "../confluence/pageTree";
import {
  buildPageMarkdownFiles,
  calculateMarkdownBodyHash,
  parsePageMarkdownMetadata,
  type PageMarkdownConversionIssue,
  type PageMarkdownFile
} from "../projects/pageMarkdown";
import { buildPullReportPath } from "../projects/pullReport";
import { createPullSyncPlan } from "../projects/pullSyncPolicy";
import {
  applyPullSyncPlan,
  listProjectMarkdownFiles,
  type ProjectStorageAdapter,
  type PullSyncApplyResult
} from "../projects/projectStorage";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";

export type PullTreeFetcher = (
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string
) => Promise<ConfluenceRootContentTreeResult>;

export interface RunPullTreeCommandInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  fetchTree?: PullTreeFetcher;
  ensureCurrentProject?: PullTreeProjectEnsurer;
  mode?: "normal" | "force";
  confirmForcePull?: (message: string) => boolean;
  showNotice: (message: string) => void;
  openReport?: (path: string) => Promise<void>;
}

export type PullTreeProjectEnsurer = (
  input: PullTreeProjectEnsurerInput
) => Promise<PullTreeProjectEnsurerResult>;

export interface PullTreeProjectEnsurerInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
}

export type PullTreeProjectEnsurerResult =
  | {
      ok: true;
      currentProject: CurrentConfluenceProjectSettings;
    }
  | {
      ok: false;
      message: string;
    };

const forcePullConfirmationMessage = "로컬의 변경사항이 모두 취소됩니다. 정말 실행하시겠습니까?";

function buildForcePullConfirmationMessage(changedLocalFileCount: number): string {
  return `${forcePullConfirmationMessage}\n\n로컬 변경사항: ${changedLocalFileCount}건`;
}

const defaultPullTreeFetcher: PullTreeFetcher = async (settings, rootContentType, rootContentId) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return fetchConfluenceRootContentTree(settings, rootContentType, rootContentId, createObsidianRequestTransport);
};

export async function runPullTreeCommand({
  settings,
  storage,
  fetchTree = defaultPullTreeFetcher,
  ensureCurrentProject,
  mode = "normal",
  confirmForcePull,
  showNotice,
  openReport
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

  try {
    const currentProject = await resolveCurrentProjectForPull({
      settings,
      storage,
      ensureCurrentProject,
      showNotice,
      openReport
    });

    if (currentProject === null) {
      return;
    }

    const safeDeleteRootPath = buildSafeDeleteRootPath(
      currentProject.localFolderPath,
      settings.safeDeleteFolder,
      new Date()
    );
    let localMarkdownFilesResult: Awaited<ReturnType<typeof listProjectMarkdownFiles>> | null = null;

    try {
      if (mode === "force") {
        localMarkdownFilesResult = await listProjectMarkdownFiles(
          storage,
          currentProject.localFolderPath,
          removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath)
        );

        if (!localMarkdownFilesResult.ok) {
          showNotice(localMarkdownFilesResult.message);
          return;
        }

        const changedLocalFiles = collectChangedLocalMarkdownFiles(localMarkdownFilesResult.files);
        const shouldContinue =
          confirmForcePull?.(buildForcePullConfirmationMessage(changedLocalFiles.length)) ?? true;

        if (!shouldContinue) {
          const reportPath = await writeForcePullCancelReport(storage, currentProject.localFolderPath, {
            pulledAt: new Date(),
            changedLocalFiles
          });

          if (openReport !== undefined) {
            try {
              await openReport(reportPath);
            } catch {
              showNotice(`Pull 리포트를 열 수 없습니다: ${reportPath}`);
            }
          }

          showNotice("Force Pull을 취소했습니다. 변경된 로컬 파일 목록을 리포트로 남겼습니다.");
          return;
        }
      }
    } catch {
      showNotice("Markdown 파일을 저장할 수 없습니다.");
      return;
    }

    const result = await fetchTree(settings, currentProject.rootContentType, currentProject.rootContentId);

    if (!result.ok) {
      showNotice(result.message);
      return;
    }

    let markdownFiles: PageMarkdownFile[];
    let writeResult: PullSyncApplyResult;
    let syncPlan: ReturnType<typeof createPullSyncPlan>;
    let conversionWarningCount = 0;
    let conversionFailureCount = 0;

    try {
      if (localMarkdownFilesResult === null) {
        localMarkdownFilesResult = await listProjectMarkdownFiles(
          storage,
          currentProject.localFolderPath,
          removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath)
        );
      }

      if (!localMarkdownFilesResult.ok) {
        showNotice(localMarkdownFilesResult.message);
        return;
      }

      const localMarkdownFiles = localMarkdownFilesResult;
      const markdownBuildResult = await buildPageMarkdownFiles({
        projectRootPath: currentProject.localFolderPath,
        root: result.root,
        pages: result.pages,
        existingPagePathById: buildExistingPagePathById(localMarkdownFiles.files),
        pathExists: (path) => storage.exists(path),
        readExistingFile: (path) => storage.read(path)
      });
      markdownFiles = markdownBuildResult.files;

      syncPlan = createPullSyncPlan(
        {
          projectRootPath: currentProject.localFolderPath,
          safeDeleteRootPath,
          remoteFiles: markdownFiles,
          localFiles: localMarkdownFiles.files
        },
        { forceOverwriteLocalChanges: mode === "force" }
      );

      writeResult = await applyPullSyncPlan(storage, syncPlan);
      conversionWarningCount = markdownBuildResult.conversionIssues.filter(
        (issue) => issue.severity === "warning"
      ).length;
      conversionFailureCount = markdownBuildResult.conversionIssues.filter(
        (issue) => issue.severity === "error"
      ).length;

      if (writeResult.ok) {
        const reportPath = await writePullReport(storage, currentProject.localFolderPath, {
          pulledAt: new Date(),
          createCount: syncPlan.filesToWrite.filter((file) => file.operation === "create").length,
          updateCount: syncPlan.filesToWrite.filter((file) => file.operation === "update").length,
          writeResult,
          syncPlan,
          fetchFailureCount: result.errors.length,
          fetchFailures: result.errors,
          conversionIssues: markdownBuildResult.conversionIssues,
          conversionWarningCount,
          conversionFailureCount
        });

        if (openReport !== undefined) {
          try {
            await openReport(reportPath);
          } catch {
            showNotice(`Pull 리포트를 열 수 없습니다: ${reportPath}`);
          }
        }
      }
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
    showNotice(
      `${mode === "force" ? "Force Pull" : "Pull"} 완료: 추가 ${createCount}개, 갱신 ${updateCount}개${buildForceOverwriteNoticePart(
        mode,
        syncPlan.overwrittenLocalChanges.length
      )}, 안전 삭제 ${writeResult.safeDeletedFileCount}개, 로컬 수정 스킵 ${writeResult.skippedLocalChangeCount}개, 변경 없음 ${writeResult.unchangedFileCount}개${buildSuccessNoticeSuffix(
        result.errors.length,
        conversionWarningCount,
        conversionFailureCount
      )}`
    );
  } catch (error) {
    console.error("Pull Tree 실행 중 예기치 못한 오류가 발생했습니다.", error);

    const message = error instanceof Error ? error.message : "Confluence 페이지 트리 조회 중 알 수 없는 오류가 발생했습니다.";
    showNotice(message);
  }
}

async function resolveCurrentProjectForPull({
  settings,
  storage,
  ensureCurrentProject,
  showNotice,
  openReport
}: {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  ensureCurrentProject: PullTreeProjectEnsurer | undefined;
  showNotice: (message: string) => void;
  openReport: ((path: string) => Promise<void>) | undefined;
}): Promise<CurrentConfluenceProjectSettings | null> {
  if (settings.currentProject !== null) {
    return settings.currentProject;
  }

  if (ensureCurrentProject === undefined) {
    showNotice("Pull Tree 실행 전에 Root content URL 설정이 필요합니다.");
    return null;
  }

  const result = await ensureCurrentProject({ settings, storage });

  if (result.ok) {
    return result.currentProject;
  }

  const reportPath = await writeProjectInitializationFailureReport(storage, {
    failedAt: new Date(),
    message: result.message
  });

  if (openReport !== undefined) {
    try {
      await openReport(reportPath);
    } catch {
      showNotice(`Pull 리포트를 열 수 없습니다: ${reportPath}`);
    }
  }

  showNotice(`프로젝트 초기화 실패: ${result.message}`);
  return null;
}

function buildForceOverwriteNoticePart(mode: "normal" | "force", overwrittenCount: number): string {
  return mode === "force" ? `, 강제 덮어쓰기 ${overwrittenCount}개` : "";
}

function buildSuccessNoticeSuffix(
  fetchFailureCount: number,
  conversionWarningCount: number,
  conversionFailureCount: number
): string {
  const suffixes: string[] = [];

  if (fetchFailureCount > 0) {
    suffixes.push(`조회 실패 ${fetchFailureCount}개`);
  }

  if (conversionWarningCount > 0) {
    suffixes.push(`변환 경고 ${conversionWarningCount}개`);
  }

  if (conversionFailureCount > 0) {
    suffixes.push(`변환 실패 ${conversionFailureCount}개`);
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

interface PullReportInput {
  pulledAt: Date;
  createCount: number;
  updateCount: number;
  writeResult: Extract<PullSyncApplyResult, { ok: true }>;
  syncPlan: ReturnType<typeof createPullSyncPlan>;
  fetchFailureCount: number;
  fetchFailures: ConfluencePageTreeError[];
  conversionIssues: PageMarkdownConversionIssue[];
  conversionWarningCount: number;
  conversionFailureCount: number;
}

interface ForcePullCancelReportInput {
  pulledAt: Date;
  changedLocalFiles: ChangedLocalMarkdownFile[];
}

interface ProjectInitializationFailureReportInput {
  failedAt: Date;
  message: string;
}

interface ChangedLocalMarkdownFile {
  vaultPath: string;
  pageId: string;
  skipReason: "local-change";
}

async function writePullReport(
  storage: ProjectStorageAdapter,
  projectRootPath: string,
  reportInput: PullReportInput
): Promise<string> {
  const reportPath = buildPullReportPath(projectRootPath);
  const reportFolderPath = reportPath.split("/").slice(0, -1).join("/");

  if (!(await storage.exists(reportFolderPath))) {
    await storage.mkdir(reportFolderPath);
  }

  await storage.write(reportPath, buildPullReportMarkdown(reportInput));

  return reportPath;
}

async function writeForcePullCancelReport(
  storage: ProjectStorageAdapter,
  projectRootPath: string,
  reportInput: ForcePullCancelReportInput
): Promise<string> {
  const reportPath = buildPullReportPath(projectRootPath);
  const reportFolderPath = reportPath.split("/").slice(0, -1).join("/");

  if (!(await storage.exists(reportFolderPath))) {
    await storage.mkdir(reportFolderPath);
  }

  await storage.write(reportPath, buildForcePullCancelReportMarkdown(reportInput));

  return reportPath;
}

async function writeProjectInitializationFailureReport(
  storage: ProjectStorageAdapter,
  reportInput: ProjectInitializationFailureReportInput
): Promise<string> {
  const reportPath = buildPullReportPath("");
  const reportFolderPath = reportPath.split("/").slice(0, -1).join("/");

  if (!(await storage.exists(reportFolderPath))) {
    await storage.mkdir(reportFolderPath);
  }

  await storage.write(reportPath, buildProjectInitializationFailureReportMarkdown(reportInput));

  return reportPath;
}

function buildPullReportMarkdown(input: PullReportInput): string {
  const lines = [
    "# Pull Report",
    "",
    `- 실행 시각: ${input.pulledAt.toISOString()}`,
    `- 추가: ${input.createCount}개`,
    `- 갱신: ${input.updateCount}개`,
    `- 안전 삭제: ${input.writeResult.safeDeletedFileCount}개`,
    `- 로컬 수정 스킵: ${input.writeResult.skippedLocalChangeCount}개`,
    `- 변경 없음: ${input.writeResult.unchangedFileCount}개`,
    `- 조회 실패: ${input.fetchFailureCount}개`,
    `- 변환 경고: ${input.conversionWarningCount}개`,
    `- 변환 실패: ${input.conversionFailureCount}개`,
    "",
    "## 조회 실패 상세",
    ...formatFetchFailures(input.fetchFailures),
    "",
    "## 변환 문제 상세",
    ...formatConversionIssues(input.conversionIssues),
    "",
    "## 추가",
    ...formatWrittenFiles(input.syncPlan.filesToWrite.filter((file) => file.operation === "create")),
    "",
    "## 갱신",
    ...formatWrittenFiles(input.syncPlan.filesToWrite.filter((file) => file.operation === "update")),
    "",
    "## 안전 삭제",
    ...formatSafeDeletedFiles(input.syncPlan.filesToMoveToSafeDelete),
    "",
    "## 로컬 수정 스킵",
    ...formatSkippedFiles(input.syncPlan.skippedLocalChanges),
    "",
    "## 강제 덮어쓰기",
    ...formatSkippedFiles(input.syncPlan.overwrittenLocalChanges),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function buildForcePullCancelReportMarkdown(input: ForcePullCancelReportInput): string {
  const lines = [
    "# Force Pull 취소 리포트",
    "",
    `- 실행 시각: ${input.pulledAt.toISOString()}`,
    `- 변경된 로컬 파일: ${input.changedLocalFiles.length}개`,
    "",
    "## 변경된 로컬 파일",
    ...formatChangedLocalFiles(input.changedLocalFiles),
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function buildProjectInitializationFailureReportMarkdown(input: ProjectInitializationFailureReportInput): string {
  const lines = [
    "# 프로젝트 초기화 실패 리포트",
    "",
    `- 실행 시각: ${input.failedAt.toISOString()}`,
    `- 실패 원인: ${input.message}`,
    ""
  ];

  return `${lines.join("\n")}\n`;
}

function collectChangedLocalMarkdownFiles(
  localMarkdownFiles: Array<{ vaultPath: string; content: string }>
): ChangedLocalMarkdownFile[] {
  const changedLocalFiles: ChangedLocalMarkdownFile[] = [];

  for (const file of localMarkdownFiles) {
    const metadata = parsePageMarkdownMetadata(file.content);

    if (metadata === null || metadata.contentHash === null) {
      continue;
    }

    if (calculateMarkdownBodyHash(metadata.bodyMarkdown) !== metadata.contentHash) {
      changedLocalFiles.push({
        vaultPath: file.vaultPath,
        pageId: metadata.pageId,
        skipReason: "local-change"
      });
    }
  }

  return changedLocalFiles;
}

function formatWrittenFiles(files: ReturnType<typeof createPullSyncPlan>["filesToWrite"]): string[] {
  if (files.length === 0) {
    return ["- 없음"];
  }

  return files.map((file) => `- ${formatVaultPathLink(file.vaultPath)} pageId=${file.pageId}`);
}

function formatSafeDeletedFiles(files: ReturnType<typeof createPullSyncPlan>["filesToMoveToSafeDelete"]): string[] {
  if (files.length === 0) {
    return ["- 없음"];
  }

  return files.map((file) => `- ${formatVaultPathLink(file.fromPath)} -> ${formatVaultPathLink(file.toPath)}`);
}

function formatSkippedFiles(files: ReturnType<typeof createPullSyncPlan>["skippedLocalChanges"]): string[] {
  if (files.length === 0) {
    return ["- 없음"];
  }

  return files.map(
    (file) => `- ${formatVaultPathLink(file.vaultPath)} pageId=${file.pageId} reason=${file.skipReason ?? "unknown"}`
  );
}

function formatChangedLocalFiles(files: ChangedLocalMarkdownFile[]): string[] {
  if (files.length === 0) {
    return ["- 없음"];
  }

  return files.map((file) => `- ${formatVaultPathLink(file.vaultPath)} pageId=${file.pageId} reason=${file.skipReason}`);
}

function formatFetchFailures(files: PullReportInput["fetchFailures"]): string[] {
  if (files.length === 0) {
    return ["- 없음"];
  }

  return files.map(
    (failure) =>
      `- pageId=${failure.pageId} title=${JSON.stringify(failure.title ?? "")} reason=${failure.reason} message=${JSON.stringify(failure.message)}`
  );
}

function formatConversionIssues(issues: PullReportInput["conversionIssues"]): string[] {
  if (issues.length === 0) {
    return ["- 없음"];
  }

  return issues.map(
    (issue) =>
      `- pageId=${issue.pageId} title=${JSON.stringify(issue.title)} severity=${issue.severity} message=${JSON.stringify(issue.message)}`
  );
}

function formatVaultPathLink(vaultPath: string): string {
  return `[[${vaultPath}]]`;
}
