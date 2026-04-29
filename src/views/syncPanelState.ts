import { buildPullReportPath, parsePullReportMarkdown, type PullReportSummary } from "../projects/pullReport";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";

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
}

export interface BuildSyncPanelStateInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
}

export async function buildSyncPanelState({ settings, storage }: BuildSyncPanelStateInput): Promise<SyncPanelState> {
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
      canRunProjectActions: false
    };
  }

  return buildProjectState(currentProject, storage);
}

async function buildProjectState(
  currentProject: CurrentConfluenceProjectSettings,
  storage: ProjectStorageAdapter
): Promise<SyncPanelState> {
  const latestReportPath = buildPullReportPath(currentProject.localFolderPath);
  const baseState = {
    hasProject: true,
    projectName: currentProject.projectName,
    localFolderPath: currentProject.localFolderPath,
    rootUrl: currentProject.rootUrl,
    rootContentLabel: currentProject.rootContentType === "folder" ? "루트 폴더" : "루트 페이지",
    latestReportPath,
    canRunProjectActions: true
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
