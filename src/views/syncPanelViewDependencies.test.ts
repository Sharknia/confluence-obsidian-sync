import { describe, expect, it, vi } from "vitest";
import type { GraphifyOutputFileState } from "../graphify/graphifyCli";
import { createSyncPanelViewDependencies } from "./syncPanelViewDependencies";

describe("createSyncPanelViewDependencies", () => {
  it("passes graphify provider into Sync Panel state loading", async () => {
    const graphifyProvider = {
      isDesktop: true,
      getRunStatus: () => ({ kind: "idle" as const, message: "" }),
      checkAvailability: vi.fn((executable: string) => Promise.resolve({
        installed: true,
        executable,
        message: "graphify 0.3.24"
      }))
    };
    const dependencies = createSyncPanelViewDependencies({
      settings: {
        confluenceBaseUrl: "https://selta.atlassian.net",
        userEmail: "",
        apiToken: "",
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
        }
      },
      storage: {
        exists: vi.fn(() => Promise.resolve(false)),
        mkdir: vi.fn(() => Promise.resolve()),
        read: vi.fn(() => Promise.resolve("")),
        write: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve({ files: [], folders: [] })),
        rename: vi.fn(() => Promise.resolve())
      },
      graphifyProvider,
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

    const state = await dependencies.loadState();

    expect(state.graphify.visible).toBe(true);
    expect(graphifyProvider.checkAvailability).toHaveBeenCalledWith("graphify");
  });

  it("wires graphify run and output actions", async () => {
    const onRunGraphify = vi.fn();
    const onOpenGraphifyOutput = vi.fn();
    const onCopyGraphifyMessage = vi.fn();
    const dependencies = createSyncPanelViewDependencies({
      settings: {
        confluenceBaseUrl: "https://selta.atlassian.net",
        userEmail: "",
        apiToken: "",
        defaultProjectFolder: "confluence",
        safeDeleteFolder: ".confluence-sync/trash",
        graphifyExecutablePath: "",
        graphifyTimeoutSeconds: 600,
        currentProject: null
      },
      storage: {
        exists: vi.fn(() => Promise.resolve(false)),
        mkdir: vi.fn(() => Promise.resolve()),
        read: vi.fn(() => Promise.resolve("")),
        write: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve({ files: [], folders: [] })),
        rename: vi.fn(() => Promise.resolve())
      },
      graphifyProvider: undefined,
      onPullTree: vi.fn(),
      onForcePullTree: vi.fn(),
      onPullCurrentPage: vi.fn(),
      onPushCurrentPage: vi.fn(),
      onOpenRootLink: vi.fn(),
      onOpenLatestReport: vi.fn(),
      onRunGraphify,
      onOpenGraphifyOutput,
      onCopyGraphifyMessage
    });
    const outputFile: GraphifyOutputFileState = {
      label: "graph.json",
      path: "graphify-out/graph.json",
      exists: true,
      openKind: "external"
    };

    await dependencies.actions.onRunGraphify({ kind: "cli-code-update" });
    await dependencies.actions.onOpenGraphifyOutput(outputFile);
    await dependencies.actions.onCopyGraphifyMessage("graphify 실행 실패: missing dependency");

    expect(onRunGraphify).toHaveBeenCalledWith({ kind: "cli-code-update" });
    expect(onOpenGraphifyOutput).toHaveBeenCalledWith(outputFile);
    expect(onCopyGraphifyMessage).toHaveBeenCalledWith("graphify 실행 실패: missing dependency");
  });
});
