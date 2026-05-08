import { describe, expect, it, vi } from "vitest";
import { createSyncPanelViewFactory } from "./registerSyncPanelView";

describe("createSyncPanelViewFactory", () => {
  it("asks for a fresh graphify provider when the view state loads", async () => {
    const getGraphifyProvider = vi.fn(() => ({
      isDesktop: true,
      getRunStatus: () => ({ kind: "success" as const, message: "graphify 실행이 완료되었습니다." }),
      checkAvailability: vi.fn((executable: string) => Promise.resolve({
        installed: true,
        executable,
        message: "graphify 0.3.24"
      }))
    }));
    const factory = createSyncPanelViewFactory({
      getSettings: () => ({
        confluenceBaseUrl: "https://selta.atlassian.net",
        userEmail: "",
        apiToken: "",
        defaultProjectFolder: "confluence",
        safeDeleteFolder: ".confluence-sync/trash",
        graphifyExecutablePath: "",
        graphifyTimeoutSeconds: 600,
        currentProject: null
      }),
      getStorage: () => ({
        exists: vi.fn(() => Promise.resolve(false)),
        mkdir: vi.fn(() => Promise.resolve()),
        read: vi.fn(() => Promise.resolve("")),
        write: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve({ files: [], folders: [] })),
        rename: vi.fn(() => Promise.resolve())
      }),
      getGraphifyProvider,
      createView: (_leaf, dependencies) => ({ dependencies }),
      onPullTree: vi.fn(),
      onForcePullTree: vi.fn(),
      onPullCurrentPage: vi.fn(),
      onPushCurrentPage: vi.fn(),
      onOpenRootLink: vi.fn(),
      onOpenLatestReport: vi.fn(),
      onRunGraphify: vi.fn(),
      onOpenGraphifyOutput: vi.fn(),
      onCopyGraphifyMessage: vi.fn()
    });

    const view = factory({ id: "leaf" });
    await view.dependencies.loadState();
    await view.dependencies.loadState();

    expect(getGraphifyProvider).toHaveBeenCalledTimes(2);
  });
});
