import type { GraphifyOutputFileState } from "../graphify/graphifyCli";
import type { GraphifyRunMode } from "../graphify/graphifyPanelActions";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import { createSyncPanelViewDependencies } from "./syncPanelViewDependencies";
import type { SyncPanelGraphifyProvider } from "./syncPanelState";
import type { SyncPanelViewDependencies } from "./syncPanelView";

export interface CreateSyncPanelViewFactoryInput<TLeaf, TView> {
  getSettings: () => ConfluenceSyncSettings;
  getStorage: () => ProjectStorageAdapter;
  getGraphifyProvider: () => SyncPanelGraphifyProvider | undefined;
  createView: (leaf: TLeaf, dependencies: SyncPanelViewDependencies) => TView;
  onPullTree: () => void | Promise<void>;
  onForcePullTree: () => void | Promise<void>;
  onPullCurrentPage: () => void | Promise<void>;
  onPushCurrentPage: () => void | Promise<void>;
  onOpenRootLink: () => void | Promise<void>;
  onOpenLatestReport: () => void | Promise<void>;
  onOpenVaultTerminal: () => void | Promise<void>;
  onUpdatePlugin: () => void | Promise<void>;
  onRunGraphify: (runMode: GraphifyRunMode) => void | Promise<void>;
  onOpenGraphifyOutput: (outputFile: GraphifyOutputFileState) => void | Promise<void>;
  onCopyGraphifyMessage: (message: string) => void | Promise<void>;
}

export function createSyncPanelViewFactory<TLeaf, TView>(
  input: CreateSyncPanelViewFactoryInput<TLeaf, TView>
): (leaf: TLeaf) => TView {
  const actions = {
    onPullTree: input.onPullTree,
    onForcePullTree: input.onForcePullTree,
    onPullCurrentPage: input.onPullCurrentPage,
    onPushCurrentPage: input.onPushCurrentPage,
    onOpenRootLink: input.onOpenRootLink,
    onOpenLatestReport: input.onOpenLatestReport,
    onOpenVaultTerminal: input.onOpenVaultTerminal,
    onUpdatePlugin: input.onUpdatePlugin,
    onRunGraphify: input.onRunGraphify,
    onOpenGraphifyOutput: input.onOpenGraphifyOutput,
    onCopyGraphifyMessage: input.onCopyGraphifyMessage
  };

  return (leaf) =>
    input.createView(leaf, {
      loadState: () =>
        createSyncPanelViewDependencies({
          settings: input.getSettings(),
          storage: input.getStorage(),
          graphifyProvider: input.getGraphifyProvider(),
          ...actions
        }).loadState(),
      actions
    });
}
