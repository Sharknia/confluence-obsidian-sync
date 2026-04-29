import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import type { SyncPanelState } from "./syncPanelState";
import { renderSyncPanelContent, type SyncPanelActions } from "./syncPanelRenderer";

function createState(overrides: Partial<SyncPanelState> = {}): SyncPanelState {
  return {
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
    ...overrides
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
    expect(containerEl.querySelectorAll(".confluence-sync-panel-action-card")).toHaveLength(4);
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
    const buttons = Array.from(containerEl.querySelectorAll("button"));
    buttons.find((button) => button.textContent === "Open root link")?.click();
    buttons.find((button) => button.textContent === "Open latest report")?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(actions.onForcePullTree).toHaveBeenCalledOnce();
    expect(actions.onPullCurrentPage).toHaveBeenCalledOnce();
    expect(actions.onPushCurrentPage).toHaveBeenCalledOnce();
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

    pullButton?.click();
    pullButton?.click();
    forcePullButton?.click();
    pullCurrentButton?.click();
    pushButton?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(actions.onForcePullTree).not.toHaveBeenCalled();
    expect(actions.onPullCurrentPage).not.toHaveBeenCalled();
    expect(actions.onPushCurrentPage).not.toHaveBeenCalled();
    expect(pullButton?.disabled).toBe(true);
    expect(forcePullButton?.disabled).toBe(true);
    expect(pullCurrentButton?.disabled).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(pullButton?.getAttribute("aria-busy")).toBe("true");
    expect(containerEl.textContent).toContain("Pull Tree 진행 중입니다...");

    finishPull?.();
    await Promise.resolve();

    expect(pullButton?.disabled).toBe(false);
    expect(forcePullButton?.disabled).toBe(false);
    expect(pullCurrentButton?.disabled).toBe(false);
    expect(pushButton?.disabled).toBe(false);
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

    pushButton?.click();
    pushButton?.click();
    pullCurrentButton?.click();
    pullButton?.click();
    forcePullButton?.click();

    expect(actions.onPushCurrentPage).toHaveBeenCalledOnce();
    expect(actions.onPullCurrentPage).not.toHaveBeenCalled();
    expect(actions.onPullTree).not.toHaveBeenCalled();
    expect(actions.onForcePullTree).not.toHaveBeenCalled();
    expect(pullButton?.disabled).toBe(true);
    expect(forcePullButton?.disabled).toBe(true);
    expect(pullCurrentButton?.disabled).toBe(true);
    expect(pushButton?.disabled).toBe(true);
    expect(pushButton?.getAttribute("aria-busy")).toBe("true");
    expect(containerEl.textContent).toContain("Push Current Page 진행 중입니다...");

    finishPush?.();
    await Promise.resolve();

    expect(pullButton?.disabled).toBe(false);
    expect(forcePullButton?.disabled).toBe(false);
    expect(pullCurrentButton?.disabled).toBe(false);
    expect(pushButton?.disabled).toBe(false);
    expect(pushButton?.hasAttribute("aria-busy")).toBe(false);
    expect(containerEl.textContent).toContain("Push Current Page 완료");
  });

  it("disables project actions when no project exists", () => {
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

    expect(findActionButton(containerEl, "Pull Tree")?.disabled).toBe(true);
    expect(findActionButton(containerEl, "Force Pull Tree")?.disabled).toBe(true);
    expect(findActionButton(containerEl, "Pull Current Page")?.disabled).toBe(true);
    expect(findActionButton(containerEl, "Push Current Page")?.disabled).toBe(true);
    expect(containerEl.textContent).toContain("현재 문서 내려받기");
    expect(containerEl.textContent).toContain("현재 프로젝트 없음");
  });
});
