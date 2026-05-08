import { describe, expect, it, vi } from "vitest";
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
    graphifyExecutablePath: "",
    graphifyTimeoutSeconds: 600,
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

function createStorageWithListing(files: Record<string, string>, listing: { files: string[]; folders: string[] }): ProjectStorageAdapter {
  return {
    ...createStorage(files),
    list: () => Promise.resolve(listing)
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
      canRunProjectActions: false,
      graphify: {
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
      }
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
      canRunProjectActions: true,
      graphify: {
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
      }
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

  it("hides graphify integration outside Desktop Obsidian", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorage({}),
      graphify: {
        isDesktop: false,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: () => Promise.resolve({ installed: true, executable: "graphify", message: "graphify 0.3.24" })
      }
    });

    expect(state.graphify.visible).toBe(false);
    expect(state.graphify.canRun).toBe(false);
  });

  it("shows graphify guidance without a run button when no project exists on Desktop", async () => {
    const graphify = {
      isDesktop: true,
      getRunStatus: () => ({ kind: "idle" as const, message: "" }),
      checkAvailability: vi.fn((executable: string) => Promise.resolve({ installed: true, executable, message: "graphify 0.3.24" }))
    };
    const state = await buildSyncPanelState({
      settings: createSettings({ currentProject: null }),
      storage: createStorage({
        "graphify-out/GRAPH_REPORT.md": "# Old Report"
      }),
      graphify
    });

    expect(state.hasProject).toBe(false);
    expect(state.graphify.visible).toBe(true);
    expect(state.graphify.canRun).toBe(false);
    expect(graphify.checkAvailability).not.toHaveBeenCalled();
    expect(state.graphify.outputFiles[0]).toMatchObject({
      path: "graphify-out/GRAPH_REPORT.md",
      exists: true
    });
  });

  it("shows install guidance on Desktop when graphify is missing", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings({ graphifyExecutablePath: "/custom/graphify" }),
      storage: createStorage({}),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: (executable) => Promise.resolve({
          installed: false,
          executable,
          message: "graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요."
        })
      }
    });

    expect(state.graphify).toMatchObject({
      visible: true,
      installed: false,
      canRun: false,
      executable: "/custom/graphify",
      message: "graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요.",
      runStatus: { kind: "idle", message: "" }
    });
  });

  it("disables graphify run while execution is running", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorage({}),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "running", message: "graphify 실행 중입니다..." }),
        checkAvailability: (executable) => Promise.resolve({ installed: true, executable, message: "graphify 0.3.24" })
      }
    });

    expect(state.graphify.visible).toBe(true);
    expect(state.graphify.installed).toBe(true);
    expect(state.graphify.canRun).toBe(false);
    expect(state.graphify.message).toBe("Graphify 실행 로그");
    expect(state.graphify.runStatus.message).toBe("graphify 실행 중입니다...");
  });

  it("keeps graphify failure message in state after refresh", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorageWithListing({}, { files: ["confluence/기획 문서/A.md"], folders: [] }),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "failure", message: "graphify 실행 실패: missing dependency" }),
        checkAvailability: (executable) => Promise.resolve({ installed: true, executable, message: "graphify 0.3.24" }),
        checkAgentRunner: () =>
          Promise.resolve({
            runner: "claude",
            runnerExecutable: "claude",
            skillInstalled: true,
            message: "Claude Code graphify skill 사용 가능"
          })
      }
    });

    expect(state.graphify.canRun).toBe(true);
    expect(state.graphify.runStatus).toEqual({
      kind: "failure",
      message: "graphify 실행 실패: missing dependency"
    });
  });

  it("keeps Sync Panel state load stable when graphify availability provider throws", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings(),
      storage: createStorage({}),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: () => Promise.reject(new Error("provider failed"))
      }
    });

    expect(state.graphify.visible).toBe(true);
    expect(state.graphify.installed).toBe(false);
    expect(state.graphify.message).toBe("graphify 설치 여부를 확인할 수 없습니다: provider failed");
  });

  it("enables graphify run for Markdown projects when graphify skill runner is ready", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings({
        currentProject: {
          ...createSettings().currentProject!,
          localFolderPath: "confluence/폴더"
        }
      }),
      storage: createStorageWithListing({}, { files: ["confluence/폴더/A.md"], folders: [] }),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: vi.fn(() => Promise.resolve({
          installed: true,
          executable: "graphify",
          message: "graphify 실행 파일을 찾았습니다: graphify"
        })),
        checkAgentRunner: vi.fn(() => Promise.resolve({
          runner: "claude",
          runnerExecutable: "claude",
          skillInstalled: true,
          message: "Claude Code graphify skill 사용 가능"
        }))
      }
    });

    expect(state.graphify.canRun).toBe(true);
    expect(state.graphify.runMode).toEqual({ kind: "agent-skill", runner: "claude", runnerExecutable: "claude" });
  });

  it("uses agent skill when a project has both Markdown and code files", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings({
        currentProject: {
          ...createSettings().currentProject!,
          localFolderPath: "confluence/폴더"
        }
      }),
      storage: createStorageWithListing({}, { files: ["confluence/폴더/A.md", "confluence/폴더/example.ts"], folders: [] }),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: vi.fn(() => Promise.resolve({
          installed: true,
          executable: "graphify",
          message: "graphify 실행 파일을 찾았습니다: graphify"
        })),
        checkAgentRunner: vi.fn(() => Promise.resolve({
          runner: "opencode",
          runnerExecutable: "opencode",
          skillInstalled: true,
          message: "OpenCode graphify skill 사용 가능"
        }))
      }
    });

    expect(state.graphify.runMode).toEqual({ kind: "agent-skill", runner: "opencode", runnerExecutable: "opencode" });
  });

  it("shows setup guidance when Markdown project has graphify but no agent skill runner", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings({
        currentProject: {
          ...createSettings().currentProject!,
          localFolderPath: "confluence/폴더"
        }
      }),
      storage: createStorageWithListing({}, { files: ["confluence/폴더/A.md"], folders: [] }),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: vi.fn(() => Promise.resolve({
          installed: true,
          executable: "graphify",
          message: "graphify 실행 파일을 찾았습니다: graphify"
        })),
        checkAgentRunner: vi.fn(() => Promise.resolve({
          runner: null,
          runnerExecutable: "",
          skillInstalled: false,
          message: "Markdown graphify 실행에는 Claude Code, OpenCode, 또는 Codex graphify skill이 필요합니다."
        }))
      }
    });

    expect(state.graphify.canRun).toBe(false);
    expect(state.graphify.message).toContain("Markdown graphify 실행에는");
    expect(state.graphify.externalCommand).toBe("/graphify confluence/폴더");
  });

  it("keeps Graphify state stable for common Confluence punctuation in folder names", async () => {
    const state = await buildSyncPanelState({
      settings: createSettings({
        currentProject: {
          ...createSettings().currentProject!,
          localFolderPath: "confluence/A&B + C#1, v2: 초안"
        }
      }),
      storage: createStorageWithListing({}, { files: ["confluence/A&B + C#1, v2: 초안/A.md"], folders: [] }),
      graphify: {
        isDesktop: true,
        getRunStatus: () => ({ kind: "idle", message: "" }),
        checkAvailability: vi.fn(() => Promise.resolve({
          installed: true,
          executable: "graphify",
          message: "graphify 실행 파일을 찾았습니다: graphify"
        })),
        checkAgentRunner: vi.fn(() => Promise.resolve({
          runner: null,
          runnerExecutable: "",
          skillInstalled: false,
          message: "Markdown graphify 실행에는 Claude Code, OpenCode, 또는 Codex graphify skill이 필요합니다."
        }))
      }
    });

    expect(state.graphify.canRun).toBe(false);
    expect(state.graphify.externalCommand).toBe("/graphify confluence/A&B + C#1, v2: 초안");
  });
});
