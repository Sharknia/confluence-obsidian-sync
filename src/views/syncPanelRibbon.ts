export interface RegisterSyncPanelRibbonIconInput {
  addRibbonIcon: (icon: string, title: string, callback: () => void) => unknown;
  openSyncPanel: () => void | Promise<void>;
}

export function registerSyncPanelRibbonIcon({
  addRibbonIcon,
  openSyncPanel
}: RegisterSyncPanelRibbonIconInput): void {
  addRibbonIcon("refresh-cw", "Open Confluence Sync Panel", () => {
    void openSyncPanel();
  });
}
