import { buildPullReportPath, parsePullReportMarkdown, type PullReportSummary } from "../projects/pullReport";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";
import {
  buildGraphifyOutputFileStates,
  resolveGraphifyExecutable,
  type GraphifyAvailability,
  type GraphifyOutputFileState,
  type GraphifyRunStatus
} from "../graphify/graphifyCli";
import { createGraphifySkillCommand } from "../graphify/graphifyAgentRunner";
import type { GraphifyRunMode } from "../graphify/graphifyPanelActions";
import type { GraphifyAgentRunnerState } from "../graphify/graphifyObsidianBridge";

export interface SyncPanelGraphifyState {
  visible: boolean;
  installed: boolean;
  needsProject: boolean;
  executable: string;
  message: string;
  canRun: boolean;
  runStatus: GraphifyRunStatus;
  outputFiles: GraphifyOutputFileState[];
  externalCommand: string;
  runMode: GraphifyRunMode;
}

export interface SyncPanelGraphifyProvider {
  isDesktop: boolean;
  getRunStatus: () => GraphifyRunStatus;
  checkAvailability: (executable: string) => Promise<GraphifyAvailability>;
  checkAgentRunner?: () => Promise<GraphifyAgentRunnerState>;
}

export interface SyncPanelState {
  hasProject: boolean;
  projectName: string;
  localFolderPath: string;
  rootUrl: string;
  rootContentLabel: string;
  latestReportPath: string;
  lastPullText: string;
  recentIssueText: string;
  recentIssueLines: string[];
  canRunProjectActions: boolean;
  graphify: SyncPanelGraphifyState;
}

export interface BuildSyncPanelStateInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  graphify?: SyncPanelGraphifyProvider;
}

export async function buildSyncPanelState({ settings, storage, graphify }: BuildSyncPanelStateInput): Promise<SyncPanelState> {
  const currentProject = settings.currentProject;

  if (currentProject === null) {
    return {
      hasProject: false,
      projectName: "현재 프로젝트 없음",
      localFolderPath: "",
      rootUrl: "",
      rootContentLabel: "",
      latestReportPath: "",
      lastPullText: "Pull 기록 없음",
      recentIssueText: "최근 오류 없음",
      recentIssueLines: [],
      canRunProjectActions: false,
      graphify: await buildGraphifyState({
        storage,
        graphify,
        projectFolderPath: "",
        configuredGraphifyExecutablePath: settings.graphifyExecutablePath,
        canRunProjectGraphify: false
      })
    };
  }

  return buildProjectState(currentProject, storage, settings, graphify);
}

async function buildProjectState(
  currentProject: CurrentConfluenceProjectSettings,
  storage: ProjectStorageAdapter,
  settings: ConfluenceSyncSettings,
  graphify: SyncPanelGraphifyProvider | undefined
): Promise<SyncPanelState> {
  const latestReportPath = buildPullReportPath(currentProject.localFolderPath);
  const graphifyState = await buildGraphifyState({
    storage,
    graphify,
    projectFolderPath: currentProject.localFolderPath,
    configuredGraphifyExecutablePath: settings.graphifyExecutablePath,
    canRunProjectGraphify: true
  });
  const baseState = {
    hasProject: true,
    projectName: currentProject.projectName,
    localFolderPath: currentProject.localFolderPath,
    rootUrl: currentProject.rootUrl,
    rootContentLabel: currentProject.rootContentType === "folder" ? "루트 폴더" : "루트 페이지",
    latestReportPath,
    canRunProjectActions: true,
    graphify: graphifyState
  };

  if (!(await storage.exists(latestReportPath))) {
    return {
      ...baseState,
      lastPullText: "Pull 기록 없음",
      recentIssueText: "최근 오류 없음",
      recentIssueLines: []
    };
  }

  try {
    const reportMarkdown = await storage.read(latestReportPath);
    const reportSummary = parsePullReportMarkdown(reportMarkdown);

    if (reportSummary === null) {
      return {
        ...baseState,
        lastPullText: "Pull 리포트 형식 오류",
        recentIssueText: "Pull 리포트 형식 오류",
        recentIssueLines: []
      };
    }

    return {
      ...baseState,
      lastPullText: reportSummary.pulledAt,
      recentIssueText: buildRecentIssueText(reportSummary),
      recentIssueLines: [
        ...reportSummary.fetchFailureLines,
        ...reportSummary.conversionIssueLines,
        ...reportSummary.skippedLocalChangeLines,
        ...reportSummary.safeDeleteLines
      ].slice(0, 5)
    };
  } catch {
    return {
      ...baseState,
      lastPullText: "Pull 리포트를 읽을 수 없음",
      recentIssueText: "Pull 리포트 읽기 실패",
      recentIssueLines: []
    };
  }
}

async function buildGraphifyState({
  storage,
  graphify,
  projectFolderPath,
  configuredGraphifyExecutablePath,
  canRunProjectGraphify
}: {
  storage: ProjectStorageAdapter;
  graphify: SyncPanelGraphifyProvider | undefined;
  projectFolderPath: string;
  configuredGraphifyExecutablePath: string;
  canRunProjectGraphify: boolean;
}): Promise<SyncPanelGraphifyState> {
  if (graphify === undefined || !graphify.isDesktop) {
    return createHiddenGraphifyState();
  }

  const executable = resolveGraphifyExecutable(configuredGraphifyExecutablePath);
  const runStatus = graphify.getRunStatus();
  const outputFiles = await buildGraphifyOutputFileStates({
    exists: (path) => storage.exists(path)
  });

  if (!canRunProjectGraphify) {
    return {
      visible: true,
      installed: false,
      needsProject: true,
      executable,
      message: "현재 프로젝트를 생성하면 graphify 설치 여부를 확인하고 실행할 수 있습니다.",
      canRun: false,
      runStatus,
      outputFiles,
      externalCommand: "",
      runMode: { kind: "cli-code-update" }
    };
  }

  if (runStatus.kind === "running") {
    return {
      visible: true,
      installed: true,
      needsProject: false,
      executable,
      message: "Graphify 실행 로그",
      canRun: false,
      runStatus,
      outputFiles,
      externalCommand: "",
      runMode: { kind: "cli-code-update" }
    };
  }

  const availability = await graphify.checkAvailability(executable).catch((error): GraphifyAvailability => ({
    installed: false,
    executable,
    message: `graphify 설치 여부를 확인할 수 없습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
  }));

  if (!availability.installed) {
    return {
      visible: true,
      installed: false,
      needsProject: false,
      executable: availability.executable,
      message: availability.message,
      canRun: false,
      runStatus,
      outputFiles,
      externalCommand: "",
      runMode: { kind: "cli-code-update" }
    };
  }

  const corpusSummary = await summarizeGraphifyProjectCorpus(storage, projectFolderPath);
  const externalCommand = createGraphifySkillCommand(projectFolderPath);

  if (corpusSummary.documentFileCount > 0) {
    const agentRunner = await graphify.checkAgentRunner?.().catch(
      (): GraphifyAgentRunnerState => ({
        runner: null,
        runnerExecutable: "",
        skillInstalled: false,
        message: "Markdown graphify 실행에는 Claude Code, OpenCode, 또는 Codex graphify skill이 필요합니다."
      })
    );

    if (agentRunner?.runner !== null && agentRunner !== undefined && agentRunner.skillInstalled) {
      return {
        visible: true,
        installed: true,
        needsProject: false,
        executable: availability.executable,
        message: `${availability.message} · ${agentRunner.message}`,
        canRun: true,
        runStatus,
        outputFiles,
        externalCommand: "",
        runMode: { kind: "agent-skill", runner: agentRunner.runner, runnerExecutable: agentRunner.runnerExecutable }
      };
    }

    return {
      visible: true,
      installed: true,
      needsProject: false,
      executable: availability.executable,
      message: agentRunner?.message ?? "Markdown graphify 실행에는 Claude Code, OpenCode, 또는 Codex graphify skill이 필요합니다.",
      canRun: false,
      runStatus,
      outputFiles,
      externalCommand,
      runMode: { kind: "agent-skill", runner: "claude", runnerExecutable: "claude" }
    };
  }

  if (corpusSummary.codeFileCount === 0) {
    return {
      visible: true,
      installed: true,
      needsProject: false,
      executable: availability.executable,
      message: "graphify로 분석할 지원 파일이 없습니다.",
      canRun: false,
      runStatus,
      outputFiles,
      externalCommand: "",
      runMode: { kind: "cli-code-update" }
    };
  }

  return {
    visible: true,
    installed: availability.installed,
    needsProject: false,
    executable: availability.executable,
    message: availability.message,
    canRun: availability.installed && canRunProjectGraphify,
    runStatus,
    outputFiles,
    externalCommand: "",
    runMode: { kind: "cli-code-update" }
  };
}

function createHiddenGraphifyState(): SyncPanelGraphifyState {
  return {
    visible: false,
    installed: false,
    needsProject: false,
    executable: "",
    message: "",
    canRun: false,
    runStatus: { kind: "idle", message: "" },
    outputFiles: [],
    externalCommand: "",
    runMode: { kind: "cli-code-update" }
  };
}

const CODE_FILE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".rs",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".rb",
  ".php",
  ".swift"
]);

const DOCUMENT_FILE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".rst",
  ".html",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp"
]);

interface GraphifyProjectCorpusSummary {
  codeFileCount: number;
  documentFileCount: number;
}

async function summarizeGraphifyProjectCorpus(
  storage: ProjectStorageAdapter,
  folderPath: string,
  depth = 0
): Promise<GraphifyProjectCorpusSummary> {
  if (folderPath.length === 0 || depth > 20) {
    return { codeFileCount: 0, documentFileCount: 0 };
  }

  const listing = await storage.list(folderPath).catch(() => ({ files: [], folders: [] }));
  let codeFileCount = 0;
  let documentFileCount = 0;

  for (const filePath of listing.files) {
    const extension = getLowercaseExtension(filePath);

    if (CODE_FILE_EXTENSIONS.has(extension)) {
      codeFileCount += 1;
    }

    if (DOCUMENT_FILE_EXTENSIONS.has(extension)) {
      documentFileCount += 1;
    }
  }

  for (const childFolderPath of listing.folders) {
    if (childFolderPath.includes("/.confluence-sync") || childFolderPath.includes("/graphify-out")) {
      continue;
    }

    const childSummary = await summarizeGraphifyProjectCorpus(storage, childFolderPath, depth + 1);
    codeFileCount += childSummary.codeFileCount;
    documentFileCount += childSummary.documentFileCount;
  }

  return { codeFileCount, documentFileCount };
}

function getLowercaseExtension(path: string): string {
  const lastDotIndex = path.lastIndexOf(".");

  return lastDotIndex === -1 ? "" : path.slice(lastDotIndex).toLowerCase();
}

function buildRecentIssueText(reportSummary: PullReportSummary): string {
  const issueParts: string[] = [];

  if (reportSummary.safeDeleteCount > 0) {
    issueParts.push(`안전 삭제 ${reportSummary.safeDeleteCount}개`);
  }

  if (reportSummary.skippedLocalChangeCount > 0) {
    issueParts.push(`로컬 수정 스킵 ${reportSummary.skippedLocalChangeCount}개`);
  }

  if (reportSummary.fetchFailureCount > 0) {
    issueParts.push(`조회 실패 ${reportSummary.fetchFailureCount}개`);
  }

  if (reportSummary.conversionWarningCount > 0) {
    issueParts.push(`변환 경고 ${reportSummary.conversionWarningCount}개`);
  }

  if (reportSummary.conversionFailureCount > 0) {
    issueParts.push(`변환 실패 ${reportSummary.conversionFailureCount}개`);
  }

  return issueParts.length === 0 ? "최근 오류 없음" : issueParts.join(", ");
}
