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

describe("renderSyncPanelContent", () => {
  it("renders current project, root URL, last Pull, recent issues, and action buttons", () => {
    const containerEl = createContainer();

    renderSyncPanelContent(containerEl, createState(), {
      onPullTree: vi.fn(),
      onForcePullTree: vi.fn(),
      onPushCurrentPage: vi.fn(),
      onOpenRootLink: vi.fn(),
      onOpenLatestReport: vi.fn()
    });

    expect(containerEl.textContent).toContain("기획 문서");
    expect(containerEl.textContent).toContain("confluence/기획 문서");
    expect(containerEl.textContent).toContain("루트 페이지");
    expect(containerEl.textContent).toContain("https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root");
    expect(containerEl.querySelector("a")?.getAttribute("href")).toBe(
      "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root"
    );
    expect(containerEl.textContent).toContain("2026-04-27T07:31:08.187Z");
    expect(containerEl.textContent).toContain("로컬 수정 스킵 1개");
    expect(containerEl.textContent).toContain("Pull Tree");
    expect(containerEl.textContent).toContain("Force Pull Tree");
    expect(containerEl.textContent).not.toContain("Push Current Page");
  });

  it("wires visible action buttons", async () => {
    const containerEl = createContainer();
    const actions: SyncPanelActions = {
      onPullTree: vi.fn(),
      onForcePullTree: vi.fn(),
      onPushCurrentPage: vi.fn(),
      onOpenRootLink: vi.fn(),
      onOpenLatestReport: vi.fn()
    };

    renderSyncPanelContent(containerEl, createState(), actions);

    const buttons = Array.from(containerEl.querySelectorAll("button"));
    buttons.find((button) => button.textContent === "Pull Tree")?.click();
    await Promise.resolve();
    buttons.find((button) => button.textContent === "Force Pull Tree")?.click();
    await Promise.resolve();
    buttons.find((button) => button.textContent === "Open root link")?.click();
    buttons.find((button) => button.textContent === "Open latest report")?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(actions.onForcePullTree).toHaveBeenCalledOnce();
    expect(actions.onPushCurrentPage).not.toHaveBeenCalled();
    expect(actions.onOpenRootLink).toHaveBeenCalledOnce();
    expect(actions.onOpenLatestReport).toHaveBeenCalledOnce();
  });

  it("disables Pull Tree while pull is running and enables it after completion", async () => {
    const containerEl = createContainer();
    let finishPull: (() => void) | undefined;
    const actions: SyncPanelActions = {
      onPullTree: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPull = resolve;
          })
      ),
      onForcePullTree: vi.fn(),
      onPushCurrentPage: vi.fn(),
      onOpenRootLink: vi.fn(),
      onOpenLatestReport: vi.fn()
    };

    renderSyncPanelContent(containerEl, createState(), actions);

    const pullButton = Array.from(containerEl.querySelectorAll("button")).find(
      (button) => button.textContent === "Pull Tree"
    );
    const forcePullButton = Array.from(containerEl.querySelectorAll("button")).find(
      (button) => button.textContent === "Force Pull Tree"
    );

    pullButton?.click();
    pullButton?.click();
    forcePullButton?.click();

    expect(actions.onPullTree).toHaveBeenCalledOnce();
    expect(actions.onForcePullTree).not.toHaveBeenCalled();
    expect(pullButton?.disabled).toBe(true);
    expect(forcePullButton?.disabled).toBe(true);
    expect(pullButton?.textContent).toBe("Pull Tree 진행 중...");
    expect(containerEl.textContent).toContain("Pull Tree 진행 중입니다...");

    finishPull?.();
    await Promise.resolve();

    expect(pullButton?.disabled).toBe(false);
    expect(forcePullButton?.disabled).toBe(false);
    expect(pullButton?.textContent).toBe("Pull Tree");
    expect(containerEl.textContent).toContain("Pull Tree 완료");
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
      {
        onPullTree: vi.fn(),
        onForcePullTree: vi.fn(),
        onPushCurrentPage: vi.fn(),
        onOpenRootLink: vi.fn(),
        onOpenLatestReport: vi.fn()
      }
    );

    const buttons = Array.from(containerEl.querySelectorAll("button"));

    expect(buttons.find((button) => button.textContent === "Pull Tree")?.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent === "Force Pull Tree")?.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent === "Push Current Page")).toBeUndefined();
    expect(containerEl.textContent).toContain("현재 프로젝트 없음");
  });
});
