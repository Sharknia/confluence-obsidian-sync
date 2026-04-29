import { describe, expect, it } from "vitest";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import { buildSyncPanelState } from "./syncPanelState";

function createSettings(overrides: Partial<ConfluenceSyncSettings> = {}): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    currentProject: {
      projectName: "기획 문서",
      spaceId: "SPACE",
      rootContentType: "page",
      rootContentId: "100",
      rootPageId: "100",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
      localFolderPath: "confluence/기획 문서",
      manifestPath: "confluence/기획 문서/.confluence-sync/manifest.json"
    },
    ...overrides
  };
}

function createStorage(files: Record<string, string>): ProjectStorageAdapter {
  return {
    exists: (path) => Promise.resolve(Object.hasOwn(files, path)),
    mkdir: () => Promise.resolve(),
    read: (path) => {
      const file = files[path];

      return file === undefined ? Promise.reject(new Error("missing file")) : Promise.resolve(file);
    },
    write: () => Promise.resolve(),
    list: () => Promise.resolve({ files: [], folders: [] }),
    rename: () => Promise.resolve()
  };
}

describe("buildSyncPanelState", () => {
  it("returns empty project state when no current project exists", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings({ currentProject: null }),
      storage: createStorage({})
    });

    expect(state).toEqual({
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
    });
  });

  it("uses latest Pull report as last Pull and recent issue source", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorage({
        "logs/latest.md": `# Pull Report

- 실행 시각: 2026-04-27T07:31:08.187Z
- 추가: 1개
- 갱신: 2개
- 안전 삭제: 0개
- 로컬 수정 스킵: 1개
- 변경 없음: 70개
- 조회 실패: 0개
- 변환 경고: 3개

## 안전 삭제
- 없음

## 로컬 수정 스킵
- \`confluence/기획 문서/Draft.md\` pageId=200 reason=local-change
`
      })
    });

    expect(state).toEqual({
      hasProject: true,
      projectName: "기획 문서",
      localFolderPath: "confluence/기획 문서",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
      rootContentLabel: "루트 페이지",
      latestReportPath: "logs/latest.md",
      lastPullText: "2026-04-27T07:31:08.187Z",
      recentIssueText: "로컬 수정 스킵 1개, 변환 경고 3개",
      recentIssueLines: ["- `confluence/기획 문서/Draft.md` pageId=200 reason=local-change"],
      canRunProjectActions: true
    });
  });

  it("shows fetch failure and conversion issue details as recent issues", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorage({
        "logs/latest.md": `# Pull Report

- 실행 시각: 2026-04-29T10:11:12.000Z
- 추가: 1개
- 갱신: 0개
- 안전 삭제: 0개
- 로컬 수정 스킵: 0개
- 변경 없음: 0개
- 조회 실패: 1개
- 변환 경고: 1개
- 변환 실패: 1개

## 조회 실패 상세
- pageId=200 title="Private Child" reason=permission-denied message="Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."

## 변환 문제 상세
- pageId=100 title="Root" severity=warning message="지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: toc"
- pageId=300 title="Broken" severity=error message="Confluence storage를 Markdown으로 변환할 수 없습니다: parse failed"
`
      })
    });

    expect(state.recentIssueText).toBe("조회 실패 1개, 변환 경고 1개, 변환 실패 1개");
    expect(state.recentIssueLines).toEqual([
      '- pageId=200 title="Private Child" reason=permission-denied message="Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."',
      '- pageId=100 title="Root" severity=warning message="지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: toc"',
      '- pageId=300 title="Broken" severity=error message="Confluence storage를 Markdown으로 변환할 수 없습니다: parse failed"'
    ]);
  });

  it("handles missing latest Pull report", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorage({})
    });

    expect(state.lastPullText).toBe("Pull 기록 없음");
    expect(state.recentIssueText).toBe("최근 오류 없음");
    expect(state.latestReportPath).toBe("logs/latest.md");
  });

  it("shows report read failure as recent issue", async () => {
    const storage = createStorage({ "logs/latest.md": "# Pull Report" });
    storage.read = () => Promise.reject(new Error("adapter failed"));

    const state = await buildSyncPanelState({ settings: createSettings(), storage });

    expect(state.lastPullText).toBe("Pull 리포트를 읽을 수 없음");
    expect(state.recentIssueText).toBe("Pull 리포트 읽기 실패");
  });
});
