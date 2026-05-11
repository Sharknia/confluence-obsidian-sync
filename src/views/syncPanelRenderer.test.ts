import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import type { SyncPanelState } from "./syncPanelState";
import { renderSyncPanelContent, type SyncPanelActions } from "./syncPanelRenderer";

function createState(overrides: Partial<SyncPanelState> = {}): SyncPanelState {
  const baseState: SyncPanelState = {
    hasProject: true,
    projectName: "기획 문서",
    localFolderPath: "confluence/기획 문서",
    rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
    rootContentLabel: "루트 페이지",
    latestReportPath: "logs/latest.md",
    lastPullText: "2026-04-27T07:31:08.187Z",
    recentIssueText: "로컬 수정 스킵 1개",
    recentIssueLines: ["- `confluence/기획 문서/Draft.md` pageId=200 reason=local-change"],
    canRunProjectActions: true,
    graphify: {
      visible: true,
      installed: true,
      needsProject: false,
      executable: "graphify",
      message: "graphify 0.3.24",
      canRun: true,
      runStatus: { kind: "idle", message: "" },
      externalCommand: "",
      runMode: { kind: "cli-code-update" },
      outputFiles: [
        {
          label: "GRAPH_REPORT.md",
          path: "graphify-out/GRAPH_REPORT.md",
          exists: true,
          openKind: "markdown"
        },
        {
          label: "graph.json",
          path: "graphify-out/graph.json",
          exists: true,
          openKind: "external"
        },
        {
          label: "graph.html",
          path: "graphify-out/graph.html",
          exists: false,
          openKind: "external"
        }
      ]
    }
  };

  return {
    ...baseState,
    ...overrides,
    graphify: {
      ...baseState.graphify,
      ...overrides.graphify
    }
  };
}

function createContainer(): HTMLElement {
  const { document } = parseHTML("<main></main>");

  return document.querySelector("main") as HTMLElement;
}

function createActions(overrides: Partial<SyncPanelActions> = {}): SyncPanelActions {
  return {
    onPullTree: vi.fn(),
    onForcePullTree: vi.fn(),
    onPullCurrentPage: vi.fn(),
    onPushCurrentPage: vi.fn(),
    onOpenRootLink: vi.fn(),
    onOpenLatestReport: vi.fn(),
    onOpenVaultTerminal: vi.fn(),
    onUpdatePlugin: vi.fn(),
    onRunGraphify: vi.fn(),
    onOpenGraphifyOutput: vi.fn(),
    onCopyGraphifyMessage: vi.fn(),
    ...overrides
  };
}

function findActionButton(containerEl: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(containerEl.querySelectorAll<HTMLButtonElement>(".confluence-sync-panel-action-card")).find(
    (button) => button.getAttribute("aria-label") === label
  );
}

describe("renderSyncPanelContent", () => {
  it("renders current project, root URL, last Pull, recent issues, and action buttons", () => {
    const containerEl = createContainer();
    const actions = createActions();

    renderSyncPanelContent(containerEl, createState(), actions);

    expect(containerEl.textContent).toContain("기획 문서");
    expect(containerEl.textContent).toContain("confluence/기획 문서");
    expect(containerEl.textContent).toContain("루트 페이지");
    expect(containerEl.textContent).toContain("https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root");
    expect(containerEl.querySelector("a")?.getAttribute("href")).toBe(
      "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root"
    );
    expect(containerEl.textContent).toContain("2026-04-27T07:31:08.187Z");
    expect(containerEl.textContent).toContain("로컬 수정 스킵 1개");
    expect(containerEl.textContent).toContain("전체 내려받기");
    expect(containerEl.textContent).toContain("현재 프로젝트의 Confluence 트리를 로컬 Markdown으로 갱신합니다.");
    expect(containerEl.textContent).toContain("전체 강제 내려받기");
    expect(containerEl.textContent).toContain("로컬 수정본을 백업 없이 원격 본문으로 덮어씁니다.");
    expect(containerEl.textContent).toContain("현재 문서 내려받기");
    expect(containerEl.textContent).toContain(
      "현재 열린 Markdown 파일 1개만 원격 최신 본문으로 갱신합니다. 로컬 수정본이 있으면 연결이 해제된 백업본을 먼저 생성합니다."
    );
    expect(containerEl.textContent).toContain("현재 문서 올리기");
    expect(containerEl.textContent).toContain("현재 열린 Markdown 파일 1개를 기존 Confluence 페이지에 업로드합니다.");
    expect(containerEl.textContent).toContain("터미널 열기");
    expect(containerEl.textContent).toContain("현재 vault 루트를 터미널 작업 폴더로 엽니다.");
    expect(containerEl.textContent).toContain("플러그인 업데이트");
    expect(containerEl.textContent).toContain("GitHub 최신 릴리스의 플러그인 파일만 교체합니다. 설정은 유지됩니다.");
    expect(containerEl.querySelectorAll(".confluence-sync-panel-action-card")).toHaveLength(6);
    expect(containerEl.querySelector(".confluence-sync-panel-action-card-danger")).toBeNull();
    expect(containerEl.querySelectorAll(".confluence-sync-panel-action-button")).toHaveLength(0);
    expect(containerEl.querySelectorAll(".confluence-sync-panel-action-label")).toHaveLength(0);
    expect(findActionButton(containerEl, "Pull Tree")?.tagName).toBe("BUTTON");
    expect(findActionButton(containerEl, "Pull Tree")?.textContent).not.toContain("Pull Tree");
  });

  it("wires visible action buttons", async () => {
    const containerEl = createContainer();
    const actions = createActions();

    renderSyncPanelContent(containerEl, createState(), actions);

    findActionButton(containerEl, "Pull Tree")?.click();
    await Promise.resolve();
    findActionButton(containerEl, "Force Pull Tree")?.click();
    await Promise.resolve();
    findActionButton(containerEl, "Pull Current Page")?.click();
    await Promise.resolve();
    findActionButton(containerEl, "Push Current Page")?.click();
    await Promise.resolve();
    findActionButton(containerEl, "Open Terminal")?.click();
    await Promise.resolve();
    findActionButton(containerEl, "Update Plugin")?.click();
    await Promise.resolve();
    const buttons = Array.from(containerEl.querySelectorAll("button"));
    buttons.find((button) => button.textContent === "Open root link")?.click();
    buttons.find((button) => button.textContent === "Open latest report")?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(actions.onForcePullTree).toHaveBeenCalledOnce();
    expect(actions.onPullCurrentPage).toHaveBeenCalledOnce();
    expect(actions.onPushCurrentPage).toHaveBeenCalledOnce();
    expect(actions.onOpenVaultTerminal).toHaveBeenCalledOnce();
    expect(actions.onUpdatePlugin).toHaveBeenCalledOnce();
    expect(actions.onOpenRootLink).toHaveBeenCalledOnce();
    expect(actions.onOpenLatestReport).toHaveBeenCalledOnce();
  });

  it("disables Pull Tree while pull is running and enables it after completion", async () => {
    const containerEl = createContainer();
    let finishPull: (() => void) | undefined;
    const actions = createActions({
      onPullTree: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPull = resolve;
          })
      )
    });

    renderSyncPanelContent(containerEl, createState(), actions);

    const pullButton = findActionButton(containerEl, "Pull Tree");
    const forcePullButton = findActionButton(containerEl, "Force Pull Tree");
    const pullCurrentButton = findActionButton(containerEl, "Pull Current Page");
    const pushButton = findActionButton(containerEl, "Push Current Page");
    const terminalButton = findActionButton(containerEl, "Open Terminal");
    const updateButton = findActionButton(containerEl, "Update Plugin");

    pullButton?.click();
    pullButton?.click();
    forcePullButton?.click();
    pullCurrentButton?.click();
    pushButton?.click();
    terminalButton?.click();
    updateButton?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(actions.onForcePullTree).not.toHaveBeenCalled();
    expect(actions.onPullCurrentPage).not.toHaveBeenCalled();
    expect(actions.onPushCurrentPage).not.toHaveBeenCalled();
    expect(actions.onOpenVaultTerminal).not.toHaveBeenCalled();
    expect(actions.onUpdatePlugin).not.toHaveBeenCalled();
    expect(pullButton?.disabled).toBe(true);
    expect(forcePullButton?.disabled).toBe(true);
    expect(pullCurrentButton?.disabled).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(terminalButton?.disabled).toBe(true);
    expect(updateButton?.disabled).toBe(true);
    expect(pullButton?.getAttribute("aria-busy")).toBe("true");
    expect(containerEl.textContent).toContain("Pull Tree 진행 중입니다...");

    finishPull?.();
    await Promise.resolve();

    expect(pullButton?.disabled).toBe(false);
    expect(forcePullButton?.disabled).toBe(false);
    expect(pullCurrentButton?.disabled).toBe(false);
    expect(pushButton?.disabled).toBe(false);
    expect(terminalButton?.disabled).toBe(false);
    expect(updateButton?.disabled).toBe(false);
    expect(pullButton?.hasAttribute("aria-busy")).toBe(false);
    expect(containerEl.textContent).toContain("Pull Tree 완료");
  });

  it("disables all action buttons while Push Current Page is running", async () => {
    const containerEl = createContainer();
    let finishPush: (() => void) | undefined;
    const actions = createActions({
      onPushCurrentPage: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPush = resolve;
          })
      )
    });

    renderSyncPanelContent(containerEl, createState(), actions);

    const pullButton = findActionButton(containerEl, "Pull Tree");
    const forcePullButton = findActionButton(containerEl, "Force Pull Tree");
    const pullCurrentButton = findActionButton(containerEl, "Pull Current Page");
    const pushButton = findActionButton(containerEl, "Push Current Page");
    const terminalButton = findActionButton(containerEl, "Open Terminal");
    const updateButton = findActionButton(containerEl, "Update Plugin");

    pushButton?.click();
    pushButton?.click();
    pullCurrentButton?.click();
    pullButton?.click();
    forcePullButton?.click();
    terminalButton?.click();
    updateButton?.click();

    expect(actions.onPushCurrentPage).toHaveBeenCalledOnce();
    expect(actions.onPullCurrentPage).not.toHaveBeenCalled();
    expect(actions.onPullTree).not.toHaveBeenCalled();
    expect(actions.onForcePullTree).not.toHaveBeenCalled();
    expect(actions.onOpenVaultTerminal).not.toHaveBeenCalled();
    expect(actions.onUpdatePlugin).not.toHaveBeenCalled();
    expect(pullButton?.disabled).toBe(true);
    expect(forcePullButton?.disabled).toBe(true);
    expect(pullCurrentButton?.disabled).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(terminalButton?.disabled).toBe(true);
    expect(updateButton?.disabled).toBe(true);
    expect(pushButton?.getAttribute("aria-busy")).toBe("true");
    expect(containerEl.textContent).toContain("Push Current Page 진행 중입니다...");

    finishPush?.();
    await Promise.resolve();

    expect(pullButton?.disabled).toBe(false);
    expect(forcePullButton?.disabled).toBe(false);
    expect(pullCurrentButton?.disabled).toBe(false);
    expect(pushButton?.disabled).toBe(false);
    expect(terminalButton?.disabled).toBe(false);
    expect(updateButton?.disabled).toBe(false);
    expect(pushButton?.hasAttribute("aria-busy")).toBe(false);
    expect(containerEl.textContent).toContain("Push Current Page 완료");
  });

  it("enables project bootstrap pull actions when no project exists", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        hasProject: false,
        projectName: "현재 프로젝트 없음",
        localFolderPath: "",
        rootUrl: "",
        rootContentLabel: "",
        latestReportPath: "",
        canRunProjectActions: false
      }),
      createActions()
    );

    expect(findActionButton(containerEl, "Pull Tree")?.disabled).toBe(false);
    expect(findActionButton(containerEl, "Force Pull Tree")?.disabled).toBe(false);
    expect(findActionButton(containerEl, "Pull Current Page")?.disabled).toBe(true);
    expect(findActionButton(containerEl, "Push Current Page")?.disabled).toBe(true);
    expect(findActionButton(containerEl, "Open Terminal")?.disabled).toBe(false);
    expect(findActionButton(containerEl, "Update Plugin")?.disabled).toBe(false);
    expect(containerEl.textContent).toContain("현재 문서 내려받기");
    expect(containerEl.textContent).toContain("현재 프로젝트 없음");
  });

  it("restores initially disabled project actions after bootstrap pull finishes", async () => {
    const containerEl = createContainer();
    let finishPull: (() => void) | undefined;
    const actions = createActions({
      onPullTree: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPull = resolve;
          })
      )
    });

    renderSyncPanelContent(
      containerEl,
      createState({
        hasProject: false,
        projectName: "현재 프로젝트 없음",
        localFolderPath: "",
        rootUrl: "",
        rootContentLabel: "",
        latestReportPath: "",
        canRunProjectActions: false
      }),
      actions
    );

    const pullButton = findActionButton(containerEl, "Pull Tree");
    const forcePullButton = findActionButton(containerEl, "Force Pull Tree");
    const pullCurrentButton = findActionButton(containerEl, "Pull Current Page");
    const pushButton = findActionButton(containerEl, "Push Current Page");
    const terminalButton = findActionButton(containerEl, "Open Terminal");
    const updateButton = findActionButton(containerEl, "Update Plugin");

    pullButton?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(pullButton?.disabled).toBe(true);
    expect(forcePullButton?.disabled).toBe(true);
    expect(pullCurrentButton?.disabled).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(terminalButton?.disabled).toBe(true);
    expect(updateButton?.disabled).toBe(true);

    finishPull?.();
    await Promise.resolve();

    expect(pullButton?.disabled).toBe(false);
    expect(forcePullButton?.disabled).toBe(false);
    expect(pullCurrentButton?.disabled).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(terminalButton?.disabled).toBe(false);
    expect(updateButton?.disabled).toBe(false);
  });

  it("renders graphify run button and output buttons on Desktop when installed", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(containerEl, createState(), createActions());

    expect(containerEl.textContent).toContain("Graphify");
    expect(containerEl.textContent).toContain("graphify 0.3.24");
    expect(containerEl.textContent).toContain("지식 그래프 생성");
    expect(containerEl.textContent).toContain("GRAPH_REPORT.md");
    expect(containerEl.textContent).toContain("graph.json");
    expect(containerEl.textContent).toContain("graph.html");
    expect(Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "graph.html")?.disabled).toBe(true);
  });

  it("shows graphify install guidance and hides run button when graphify is missing", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: false,
          needsProject: false,
          executable: "graphify",
          message: "graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요.",
          canRun: false,
          runStatus: { kind: "idle", message: "" },
          outputFiles: []
        }
      }),
      createActions()
    );

    expect(containerEl.textContent).toContain("uv tool install graphifyy");
    expect(containerEl.textContent).toContain("설정에서 graphify 실행 경로를 지정하세요.");
    expect(Array.from(containerEl.querySelectorAll("button")).some((button) => button.textContent === "지식 그래프 생성")).toBe(false);
  });

  it("keeps failure status visible even when graphify is currently missing", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: false,
          needsProject: false,
          executable: "graphify",
          message: "graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요.",
          canRun: false,
          runStatus: { kind: "failure", message: "graphify 실행 실패: missing dependency" },
          outputFiles: []
        }
      }),
      createActions()
    );

    expect(containerEl.textContent).toContain("graphify 실행 실패: missing dependency");
  });

  it("keeps existing graphify output buttons visible even when graphify is missing", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: false,
          needsProject: false,
          executable: "graphify",
          message: "graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요.",
          canRun: false,
          runStatus: { kind: "idle", message: "" },
          outputFiles: [
            {
              label: "GRAPH_REPORT.md",
              path: "graphify-out/GRAPH_REPORT.md",
              exists: true,
              openKind: "markdown"
            }
          ]
        }
      }),
      createActions()
    );

    expect(containerEl.textContent).toContain("GRAPH_REPORT.md");
    expect(Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "GRAPH_REPORT.md")?.disabled).toBe(false);
  });

  it("renders running status and disables graphify run button", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: true,
          needsProject: false,
          executable: "graphify",
          message: "graphify 0.3.24",
          canRun: false,
          runStatus: { kind: "running", message: "graphify 실행 중입니다..." },
          outputFiles: []
        }
      }),
      createActions()
    );

    const runButton = Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "지식 그래프 생성");

    expect(containerEl.textContent).toContain("graphify 실행 중입니다...");
    expect(runButton?.disabled).toBe(true);
  });

  it("renders live graphify output without duplicating the running headline", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: true,
          needsProject: false,
          executable: "graphify",
          message: "Graphify 실행 로그",
          canRun: false,
          runStatus: { kind: "running", message: "graphify 실행 중입니다...\n\nextracting markdown\nbuilding graph" },
          outputFiles: []
        }
      }),
      createActions()
    );

    const copyTextArea = containerEl.querySelector<HTMLTextAreaElement>(".confluence-sync-graphify-message-copy-source");

    expect(copyTextArea?.value).toContain("extracting markdown");
    expect(copyTextArea?.value).toContain("building graph");
    expect((containerEl.textContent ?? "").split("graphify 실행 중입니다...").length - 1).toBe(1);
  });

  it("renders failure reason after refresh", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: true,
          needsProject: false,
          executable: "graphify",
          message: "graphify 0.3.24",
          canRun: true,
          runStatus: { kind: "failure", message: "graphify 실행 실패: missing dependency" },
          outputFiles: []
        }
      }),
      createActions()
    );

    expect(containerEl.textContent).toContain("graphify 실행 실패: missing dependency");
  });

  it("wires graphify failure message copy button with copyable text", async () => {
    const containerEl = createContainer();
    const actions = createActions();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: true,
          needsProject: false,
          executable: "graphify",
          message: "Usage: graphify <command>",
          canRun: true,
          runStatus: {
            kind: "failure",
            message: "graphify 실행 실패: Nothing to update or rebuild failed — check output above."
          },
          outputFiles: []
        }
      }),
      actions
    );

    const copyTextArea = containerEl.querySelector<HTMLTextAreaElement>(".confluence-sync-graphify-message-copy-source");
    const copyButton = Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "오류 복사");

    expect(copyTextArea?.readOnly).toBe(true);
    expect(copyTextArea?.value).toBe(
      "Usage: graphify <command>\n\ngraphify 실행 실패: Nothing to update or rebuild failed — check output above."
    );
    expect(
      (containerEl.textContent ?? "").split("graphify 실행 실패: Nothing to update or rebuild failed — check output above.").length - 1
    ).toBe(1);

    copyButton?.click();
    await Promise.resolve();

    expect(actions.onCopyGraphifyMessage).toHaveBeenCalledWith(
      "Usage: graphify <command>\n\ngraphify 실행 실패: Nothing to update or rebuild failed — check output above."
    );
  });

  it("does not render graphify section when graphify state is hidden", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: false,
          installed: false,
          needsProject: false,
          executable: "",
          message: "",
          canRun: false,
          runStatus: { kind: "idle", message: "" },
          outputFiles: []
        }
      }),
      createActions()
    );

    expect(containerEl.textContent).not.toContain("Graphify");
  });

  it("hides graphify run button when no current project exists", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(
      containerEl,
      createState({
        hasProject: false,
        canRunProjectActions: false,
        graphify: {
          visible: true,
          installed: true,
          needsProject: true,
          executable: "graphify",
          message: "graphify 0.3.24",
          canRun: false,
          runStatus: { kind: "idle", message: "" },
          outputFiles: []
        }
      }),
      createActions()
    );

    expect(Array.from(containerEl.querySelectorAll("button")).some((button) => button.textContent === "지식 그래프 생성")).toBe(false);
    expect(containerEl.textContent).toContain("현재 프로젝트를 생성하면 Confluence Markdown 폴더를 graphify로 분석할 수 있습니다.");
    expect(containerEl.textContent).not.toContain("uv tool install graphifyy");
    expect(containerEl.textContent).not.toContain("pipx install graphifyy");
  });

  it("wires graphify run and output buttons", async () => {
    const containerEl = createContainer();
    const actions = createActions();

    renderSyncPanelContent(containerEl, createState(), actions);

    Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "지식 그래프 생성")?.click();
    await Promise.resolve();
    Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "GRAPH_REPORT.md")?.click();
    Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "graph.json")?.click();

    expect(actions.onRunGraphify).toHaveBeenCalledWith({ kind: "cli-code-update" });
    expect(actions.onOpenGraphifyOutput).toHaveBeenCalledWith({
      label: "GRAPH_REPORT.md",
      path: "graphify-out/GRAPH_REPORT.md",
      exists: true,
      openKind: "markdown"
    });
    expect(actions.onOpenGraphifyOutput).toHaveBeenCalledWith({
      label: "graph.json",
      path: "graphify-out/graph.json",
      exists: true,
      openKind: "external"
    });
  });

  it("shows copyable external graphify command when no agent runner is ready", async () => {
    const containerEl = createContainer();
    const actions = createActions();

    renderSyncPanelContent(
      containerEl,
      createState({
        graphify: {
          visible: true,
          installed: true,
          needsProject: false,
          executable: "graphify",
          message: "Markdown graphify 실행에는 Claude Code, OpenCode, 또는 Codex graphify skill이 필요합니다.",
          canRun: false,
          runStatus: { kind: "idle", message: "" },
          externalCommand: "/graphify confluence/기획 문서",
          runMode: { kind: "agent-skill", runner: "claude", runnerExecutable: "claude" },
          outputFiles: []
        }
      }),
      actions
    );

    const copyButton = Array.from(containerEl.querySelectorAll("button")).find((button) => button.textContent === "외부 실행 명령 복사");

    expect(containerEl.textContent).not.toContain("지식 그래프 생성");
    copyButton?.click();
    await Promise.resolve();

    expect(actions.onCopyGraphifyMessage).toHaveBeenCalledWith("/graphify confluence/기획 문서");
  });
});
