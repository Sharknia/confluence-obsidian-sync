import { StorageGuardError, type StorageProgress } from "../projects/storageFailure";
import { finishCommand, type CommandResult } from "./commandResult";
import { requireRequestTransport, type ConfluenceRequestTransport } from "../confluence/requestTransport";
import { getMissingConfluenceConnectionFields, type RequiredConfluenceConnectionField } from "../confluence/authentication";
import {
  downloadConfluenceHtmlAttachment,
  fetchConfluencePageHtmlAttachments,
  type ConfluenceHtmlAttachment,
  type ConfluenceHtmlAttachmentIssue
} from "../confluence/attachments";
import {
  fetchConfluenceRootContentTree,
  type ConfluencePageTreeError,
  type ConfluencePageTreeNode,
  type ConfluencePageTreePage,
  type ConfluenceRootContentTreeResult,
  type ConfluenceRootContentType
} from "../confluence/pageTree";
import { writeHtmlAttachmentFiles, type HtmlAttachmentFileToWrite } from "../projects/htmlAttachmentStorage";
import {
  buildPageMarkdownFiles,
  calculateMarkdownBodyHash,
  parsePageMarkdownMetadata,
  type PageHtmlAttachmentFile,
  type PageMarkdownConversionIssue
} from "../projects/pageMarkdown";
import { buildPullReportPath } from "../projects/pullReport";
import { createPullSyncPlan } from "../projects/pullSyncPolicy";
import {
  applyPullSyncPlan,
  listProjectMarkdownFiles,
  type ProjectStorageAdapter,
  type PullSyncApplySuccess
} from "../projects/projectStorage";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";

export type PullTreeFetcher = (
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string
) => Promise<ConfluenceRootContentTreeResult>;

export interface PullTreeHtmlAttachmentFetchResult {
  htmlAttachmentsByPageId: Map<string, ConfluenceHtmlAttachment[]>;
  issues: PageMarkdownConversionIssue[];
}

export type PullTreeHtmlAttachmentFetcher = (
  settings: ConfluenceSyncSettings,
  pages: ConfluencePageTreePage[]
) => Promise<PullTreeHtmlAttachmentFetchResult>;

export type PullTreeHtmlAttachmentDownloader = (
  settings: ConfluenceSyncSettings,
  file: PageHtmlAttachmentFile
) => Promise<{ ok: true; file: HtmlAttachmentFileToWrite } | { ok: false; issue: PageMarkdownConversionIssue }>;

export interface RunPullTreeCommandInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  transport?: ConfluenceRequestTransport;
  fetchTree?: PullTreeFetcher;
  fetchHtmlAttachments?: PullTreeHtmlAttachmentFetcher;
  downloadHtmlAttachment?: PullTreeHtmlAttachmentDownloader;
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

export function createPullTreeDependencies(transport?: ConfluenceRequestTransport) {
const defaultPullTreeFetcher: PullTreeFetcher = async (settings, rootContentType, rootContentId) => {
  const requestTransport = requireRequestTransport(transport);

  return fetchConfluenceRootContentTree(settings, rootContentType, rootContentId, requestTransport);
};

const defaultPullTreeHtmlAttachmentFetcher: PullTreeHtmlAttachmentFetcher = async (settings, pages) => {
  const requestTransport = requireRequestTransport(transport);
  const htmlAttachmentsByPageId = new Map<string, ConfluenceHtmlAttachment[]>();
  const issues: PageMarkdownConversionIssue[] = [];

  for (const page of pages) {
    const result = await fetchConfluencePageHtmlAttachments(
      settings,
      page.pageId,
      page.title,
      requestTransport
    );

    if (result.attachments.length > 0) {
      htmlAttachmentsByPageId.set(page.pageId, result.attachments);
    }

    issues.push(...result.issues.map(toAttachmentConversionIssue));
  }

  return { htmlAttachmentsByPageId, issues };
};

const defaultPullTreeHtmlAttachmentDownloader: PullTreeHtmlAttachmentDownloader = async (settings, file) => {
  const requestTransport = requireRequestTransport(transport);
  const attachment: ConfluenceHtmlAttachment = {
    id: file.attachmentId,
    pageId: file.pageId,
    pageTitle: file.pageTitle,
    title: file.attachmentTitle,
    mediaType: "text/html",
    fileSize: null,
    downloadLink: file.downloadLink,
    versionNumber: file.versionNumber
  };
  const result = await downloadConfluenceHtmlAttachment(settings, attachment, requestTransport);

  if (!result.ok) {
    return { ok: false, issue: toAttachmentConversionIssue(result.issue) };
  }

  return { ok: true, file: { ...file, html: result.html } };
};

  return { fetchTree: defaultPullTreeFetcher, fetchHtmlAttachments: defaultPullTreeHtmlAttachmentFetcher, downloadHtmlAttachment: defaultPullTreeHtmlAttachmentDownloader };
}

export async function runPullTreeCommand({
  settings, storage, transport,
  fetchTree = createPullTreeDependencies(transport).fetchTree,
  fetchHtmlAttachments = createPullTreeDependencies(transport).fetchHtmlAttachments,
  downloadHtmlAttachment = createPullTreeDependencies(transport).downloadHtmlAttachment,
  ensureCurrentProject, mode = "normal", confirmForcePull, showNotice, openReport
}: RunPullTreeCommandInput): Promise<CommandResult> {
  const missingFields = getMissingConfluenceConnectionFields(settings);
  if (missingFields.length > 0) {
    return finishCommand(showNotice, "error", "missing-settings",
      `Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields.map(toSettingsFieldName).join(", ")}`);
  }
  const counts = { created: 0, updated: 0, safeDeleted: 0, skippedLocalChanges: 0, unchanged: 0,
    fetchFailures: 0, conversionWarnings: 0, conversionFailures: 0, attachmentFailures: 0, htmlAttachments: 0 };
  const completedPaths: string[] = [];
  let failedStage = "fetch";
  let currentProject: CurrentConfluenceProjectSettings | null = null;
  async function failure(reason: string, message: string, progress?: StorageProgress): Promise<CommandResult> {
    const hasChanges = counts.safeDeleted > 0 || completedPaths.length > 0 || (progress?.completedPaths.length ?? 0) > 0;
    const status = hasChanges || progress?.outcomeUnknown ? "partial" : progress?.guardReason ? "blocked" : "error";
    const result = finishCommand(showNotice, status, progress?.guardReason ?? reason, message, {
      counts, completedPaths: [...completedPaths, ...(progress?.completedPaths ?? [])],
      failedStage: progress?.failedStage ?? failedStage, failedPath: progress?.failedPath ?? null,
      reportPath: null, reportWritten: false
    });
    if (!currentProject || failedStage === "fetch") return result;
    return writeCommandFailureReport(storage, result);
  }
  try {
    currentProject = await resolveCurrentProjectForPull({ settings, storage, ensureCurrentProject, showNotice, openReport });
    if (!currentProject) return { status: "error", reason: "project-not-configured", message: "프로젝트 초기화를 완료하지 못했습니다." };
    const safeDeleteRootPath = buildSafeDeleteRootPath(currentProject.localFolderPath, settings.safeDeleteFolder, new Date());
    let localFiles: Awaited<ReturnType<typeof listProjectMarkdownFiles>> | null = null;
    if (mode === "force") {
      localFiles = await listProjectMarkdownFiles(storage, currentProject.localFolderPath, removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath));
      if (!localFiles.ok) return failure(localFiles.reason, localFiles.message);
      const changed = collectChangedLocalMarkdownFiles(localFiles.files);
      if (!(confirmForcePull?.(buildForcePullConfirmationMessage(changed.length)) ?? true)) {
        let reportPath: string | null = null;
        try {
          reportPath = await writeForcePullCancelReport(storage, currentProject.localFolderPath, { pulledAt: new Date(), changedLocalFiles: changed });
          if (openReport) await openReport(reportPath).catch(() => showNotice(`Pull 리포트를 열 수 없습니다: ${reportPath}`));
        } catch { /* 취소 상태를 유지하고 기록 실패를 별도로 반환한다. */ }
        return finishCommand(showNotice, "blocked", "confirmation-required", "Force Pull을 취소했습니다. 변경된 로컬 파일 목록을 리포트로 남겼습니다.", {
          confirmation: { changedLocalFiles: changed.map((file) => file.vaultPath), backupRequired: false },
          reportPath, reportWritten: reportPath !== null
        });
      }
    }
    const tree = await fetchTree(settings, currentProject.rootContentType, currentProject.rootContentId);
    if (!tree.ok) return failure(tree.reason, tree.message);
    counts.fetchFailures = tree.errors.length;
    failedStage = "prepare";
    localFiles ??= await listProjectMarkdownFiles(storage, currentProject.localFolderPath, removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath));
    if (!localFiles.ok) return failure(localFiles.reason, localFiles.message);
    const attachments = await fetchHtmlAttachments(settings, collectPagesForHtmlAttachmentFetch(tree.root, tree.pages));
    const buildInput = { projectRootPath: currentProject.localFolderPath, root: tree.root, pages: tree.pages,
      existingPagePathById: buildExistingPagePathById(localFiles.files), pathExists: (path: string) => storage.exists(path),
      readExistingFile: (path: string) => storage.read(path), htmlAttachmentsByPageId: attachments.htmlAttachmentsByPageId };
    const preliminary = await buildPageMarkdownFiles(buildInput);
    const planInput = { projectRootPath: currentProject.localFolderPath, safeDeleteRootPath, localFiles: localFiles.files };
    const preliminaryPlan = createPullSyncPlan({ ...planInput, remoteFiles: preliminary.files }, { forceOverwriteLocalChanges: mode === "force" });
    const skippedIds = new Set(preliminaryPlan.skippedLocalChanges.map((file) => file.pageId));
    const htmlFiles: HtmlAttachmentFileToWrite[] = [];
    const downloadIssues: PageMarkdownConversionIssue[] = [];
    for (const file of preliminary.htmlAttachmentFiles.filter((file) => !skippedIds.has(file.pageId))) {
      // download 직전의 파일 상태를 어댑터에 기록해 첨부 교체도 변경 검사를 받는다.
      await storage.exists(file.vaultPath);
      const downloaded = await downloadHtmlAttachment(settings, file);
      if (downloaded.ok) htmlFiles.push(downloaded.file); else downloadIssues.push(downloaded.issue);
    }
    const built = await buildPageMarkdownFiles({ ...buildInput, availableHtmlAttachmentFilesByPageId: buildAvailableHtmlAttachmentFilesByPageId(htmlFiles) });
    const issues = [...built.conversionIssues, ...attachments.issues, ...downloadIssues];
    counts.conversionWarnings = issues.filter((issue) => issue.severity === "warning").length;
    counts.conversionFailures = issues.filter((issue) => issue.severity === "error").length;
    counts.attachmentFailures = attachments.issues.length + downloadIssues.length;
    const plan = createPullSyncPlan({ ...planInput, remoteFiles: built.files }, {
      forceOverwriteLocalChanges: mode === "force", allowSafeDelete: tree.errors.length === 0 && counts.conversionFailures === 0
    });
    counts.skippedLocalChanges = plan.skippedLocalChanges.length;
    counts.unchanged = plan.unchangedFileCount;
    failedStage = "attachments";
    const htmlWritten = await writeHtmlAttachmentFiles(storage, htmlFiles);
    counts.htmlAttachments = htmlWritten.writtenFileCount;
    if (!htmlWritten.ok) return failure(htmlWritten.reason, htmlWritten.message, htmlWritten);
    completedPaths.push(...htmlFiles.map((file) => file.vaultPath));
    failedStage = "apply";
    const applied = await applyPullSyncPlan(storage, plan);
    const completedWrites = plan.filesToWrite.slice(0, applied.writtenFileCount);
    counts.created = completedWrites.filter((file) => file.operation === "create").length;
    counts.updated = completedWrites.filter((file) => file.operation === "update").length;
    counts.safeDeleted = applied.safeDeletedFileCount;
    if (!applied.ok) return failure(applied.reason, applied.message, applied);
    completedPaths.push(...(applied.completedPaths ?? completedWrites.map((file) => file.vaultPath)));
    failedStage = "report";
    const reportPath = await writePullReport(storage, currentProject.localFolderPath, {
      pulledAt: new Date(), createCount: counts.created, updateCount: counts.updated, writeResult: applied, syncPlan: plan,
      fetchFailureCount: counts.fetchFailures, fetchFailures: tree.errors, conversionIssues: issues,
      conversionWarningCount: counts.conversionWarnings, conversionFailureCount: counts.conversionFailures
    });
    if (openReport) await openReport(reportPath).catch(() => showNotice(`Pull 리포트를 열 수 없습니다: ${reportPath}`));
    const partial = counts.fetchFailures + counts.conversionFailures + counts.attachmentFailures + counts.skippedLocalChanges > 0;
    return finishCommand(showNotice, partial ? "partial" : completedPaths.length || counts.safeDeleted ? "success" : "unchanged",
      partial ? "pull-incomplete" : "pulled",
      `${mode === "force" ? "Force Pull" : "Pull"} 완료: 추가 ${counts.created}개, 갱신 ${counts.updated}개${buildForceOverwriteNoticePart(mode, plan.overwrittenLocalChanges.length)}, 안전 삭제 ${counts.safeDeleted}개, 로컬 수정 스킵 ${counts.skippedLocalChanges}개, 변경 없음 ${counts.unchanged}개${buildSuccessNoticeSuffix(counts.fetchFailures, counts.conversionWarnings, counts.conversionFailures, counts.htmlAttachments)}`,
      { counts, completedPaths, reportPath, reportWritten: true });
  } catch (error) {
    return failure(error instanceof StorageGuardError ? error.reason : failedStage === "report" ? "report-write-failed" : "operation-failed",
      failedStage === "fetch" ? "Confluence 페이지 트리 조회 중 오류가 발생했습니다." : "Markdown 파일을 저장할 수 없습니다.");
  }
}

async function writeCommandFailureReport(storage: ProjectStorageAdapter, result: CommandResult): Promise<CommandResult> {
  try {
    if (!(await storage.exists("logs"))) await storage.mkdir("logs");
    await storage.write("logs/latest.md", `# Pull 실패 또는 부분 완료\n\n- 실행 시각: ${new Date().toISOString()}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
    return { ...result, reportPath: "logs/latest.md", reportWritten: true };
  } catch {
    return { ...result, reportPath: null, reportWritten: false };
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
  conversionFailureCount: number,
  htmlAttachmentCount = 0
): string {
  const suffixes: string[] = [];

  if (htmlAttachmentCount > 0) {
    suffixes.push(`HTML 첨부 ${htmlAttachmentCount}개`);
  }

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

function collectPagesForHtmlAttachmentFetch(
  root: Extract<ConfluenceRootContentTreeResult, { ok: true }>["root"],
  pages: ConfluencePageTreePage[]
): ConfluencePageTreePage[] {
  const pagesById = new Map<string, ConfluencePageTreePage>();

  if (isConfluencePageTreeNode(root)) {
    pagesById.set(root.pageId, toConfluencePageTreePage(root));
  }

  for (const page of pages) {
    pagesById.set(page.pageId, page);
  }

  return Array.from(pagesById.values());
}

function isConfluencePageTreeNode(root: Extract<ConfluenceRootContentTreeResult, { ok: true }>["root"]): root is ConfluencePageTreeNode {
  return "pageId" in root;
}

function toConfluencePageTreePage(page: ConfluencePageTreePage): ConfluencePageTreePage {
  return {
    pageId: page.pageId,
    title: page.title,
    parentId: page.parentId,
    versionNumber: page.versionNumber,
    bodyStorageValue: page.bodyStorageValue,
    sourceUrl: page.sourceUrl,
    depth: page.depth,
    childPosition: page.childPosition
  };
}

function buildAvailableHtmlAttachmentFilesByPageId(
  files: HtmlAttachmentFileToWrite[]
): Map<string, PageHtmlAttachmentFile[]> {
  const filesByPageId = new Map<string, PageHtmlAttachmentFile[]>();

  for (const file of files) {
    const pageFiles = filesByPageId.get(file.pageId) ?? [];
    pageFiles.push({
      attachmentFileId: file.attachmentFileId,
      pageId: file.pageId,
      pageTitle: file.pageTitle,
      attachmentId: file.attachmentId,
      attachmentTitle: file.attachmentTitle,
      vaultPath: file.vaultPath,
      downloadLink: file.downloadLink,
      versionNumber: file.versionNumber
    });
    filesByPageId.set(file.pageId, pageFiles);
  }

  return filesByPageId;
}

function toAttachmentConversionIssue(issue: ConfluenceHtmlAttachmentIssue): PageMarkdownConversionIssue {
  return {
    severity: "warning",
    pageId: issue.pageId,
    title: issue.pageTitle,
    message: issue.message
  };
}

interface PullReportInput {
  pulledAt: Date;
  createCount: number;
  updateCount: number;
  writeResult: PullSyncApplySuccess;
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

    if (metadata === null) {
      continue;
    }

    if (metadata.contentHash === null || calculateMarkdownBodyHash(metadata.bodyMarkdown) !== metadata.contentHash) {
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
