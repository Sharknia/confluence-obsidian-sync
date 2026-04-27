import { ItemView, WorkspaceLeaf } from "obsidian";
import { renderSyncPanelContent, type SyncPanelActions } from "./syncPanelRenderer";
import type { SyncPanelState } from "./syncPanelState";

export const SYNC_PANEL_VIEW_TYPE = "confluence-obsidian-sync-panel";

export interface SyncPanelViewDependencies {
  loadState: () => Promise<SyncPanelState>;
  actions: SyncPanelActions;
}

export class SyncPanelView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly dependencies: SyncPanelViewDependencies
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return SYNC_PANEL_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Confluence Sync Panel";
  }

  override async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const state = await this.dependencies.loadState();
    const contentEl = this.containerEl.children[1];

    if (contentEl instanceof HTMLElement) {
      renderSyncPanelContent(contentEl, state, this.dependencies.actions);
    }
  }
}
