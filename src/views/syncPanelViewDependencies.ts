import type { GraphifyOutputFileState } from "../graphify/graphifyCli";
import type { GraphifyRunMode } from "../graphify/graphifyPanelActions";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import type { SyncPanelActions } from "./syncPanelRenderer";
import { buildSyncPanelState, type SyncPanelGraphifyProvider } from "./syncPanelState";
import type { SyncPanelViewDependencies } from "./syncPanelView";

export interface CreateSyncPanelViewDependenciesInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  graphifyProvider: SyncPanelGraphifyProvider | undefined;
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

export function createSyncPanelViewDependencies(input: CreateSyncPanelViewDependenciesInput): SyncPanelViewDependencies {
  const actions: SyncPanelActions = {
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

  return {
    loadState: () =>
      buildSyncPanelState({
        settings: input.settings,
        storage: input.storage,
        graphify: input.graphifyProvider
      }),
    actions
  };
}
