import { Notice, Plugin, TFile } from "obsidian";
import {
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID
} from "./commands/commandIds";
import { runPullTreeCommand } from "./commands/pullTreeCommand";
import { buildPullReportPath } from "./projects/pullReport";
import type { ProjectStorageAdapter } from "./projects/projectStorage";
import { ConfluenceSyncSettingTab } from "./settings/ConfluenceSyncSettingTab";
import {
  DEFAULT_CONFLUENCE_SYNC_SETTINGS,
  loadConfluenceSyncSettings,
  type ConfluenceSyncSettings
} from "./settings/defaultSettings";
import { chooseSyncPanelLeaf } from "./views/syncPanelIntegration";
import { buildSyncPanelState } from "./views/syncPanelState";
import { SYNC_PANEL_VIEW_TYPE, SyncPanelView } from "./views/syncPanelView";

export default class ConfluenceObsidianSyncPlugin extends Plugin {
  settings: ConfluenceSyncSettings = { ...DEFAULT_CONFLUENCE_SYNC_SETTINGS };

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ConfluenceSyncSettingTab(this));
    this.registerView(
      SYNC_PANEL_VIEW_TYPE,
      (leaf) =>
        new SyncPanelView(leaf, {
          loadState: () =>
            buildSyncPanelState({
              settings: this.settings,
              storage: createVaultStorageAdapter(this)
            }),
          actions: {
            onPullTree: () => this.runPullTree(),
            onPushCurrentPage: () => this.pushCurrentPage(),
            onOpenRootLink: () => this.openCurrentProjectRootLink(),
            onOpenLatestReport: () => this.openCurrentProjectLatestReport()
          }
        })
    );
    this.registerCommands();
  }

  async loadSettings(): Promise<void> {
    this.settings = await loadConfluenceSyncSettings(() => this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private registerCommands(): void {
    this.addCommand({
      id: OPEN_SYNC_PANEL_COMMAND_ID,
      name: "Open Sync Panel",
      callback: () => {
        void this.openSyncPanel();
      }
    });

    this.addCommand({
      id: PULL_TREE_COMMAND_ID,
      name: "Pull Tree",
      callback: () => {
        void this.runPullTree();
      }
    });

    this.addCommand({
      id: PUSH_CURRENT_PAGE_COMMAND_ID,
      name: "Push Current Page",
      callback: () => {
        this.pushCurrentPage();
      }
    });
  }

  private async openSyncPanel(): Promise<void> {
    const leaf = chooseSyncPanelLeaf({
      existingLeaves: this.app.workspace.getLeavesOfType(SYNC_PANEL_VIEW_TYPE),
      getRightLeaf: () => this.app.workspace.getRightLeaf(false),
      getNewLeaf: () => this.app.workspace.getLeaf(true)
    });

    await leaf.setViewState({
      type: SYNC_PANEL_VIEW_TYPE,
      active: true
    });

    this.app.workspace.revealLeaf(leaf);
  }

  private async refreshSyncPanelViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(SYNC_PANEL_VIEW_TYPE)) {
      const view = leaf.view;

      if (view instanceof SyncPanelView) {
        await view.refresh();
      }
    }
  }

  private async runPullTree(): Promise<void> {
    await runPullTreeCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      showNotice: (message) => new Notice(message),
      openReport: (path) => openVaultMarkdownFile(this, path)
    });

    await this.refreshSyncPanelViews();
  }

  private pushCurrentPage(): void {
    new Notice("Confluence Push Current Page는 단일 문서 업로드 Epic에서 구현됩니다.");
  }

  private openCurrentProjectRootLink(): void {
    const rootUrl = this.settings.currentProject?.rootUrl;

    if (rootUrl === undefined || rootUrl.length === 0) {
      new Notice("열 수 있는 루트 콘텐츠 링크가 없습니다.");
      return;
    }

    window.open(rootUrl);
  }

  private async openCurrentProjectLatestReport(): Promise<void> {
    const currentProject = this.settings.currentProject;

    if (currentProject === null) {
      new Notice("현재 프로젝트가 없어 Pull 리포트를 열 수 없습니다.");
      return;
    }

    await openVaultMarkdownFile(this, buildPullReportPath(currentProject.localFolderPath));
  }
}

function createVaultStorageAdapter(plugin: ConfluenceObsidianSyncPlugin): ProjectStorageAdapter {
  return {
    exists: (path) => plugin.app.vault.adapter.exists(path),
    mkdir: (path) => plugin.app.vault.adapter.mkdir(path),
    read: (path) => plugin.app.vault.adapter.read(path),
    write: (path, data) => plugin.app.vault.adapter.write(path, data),
    list: (path) => plugin.app.vault.adapter.list(path),
    rename: (fromPath, toPath) => plugin.app.vault.adapter.rename(fromPath, toPath)
  };
}

async function openVaultMarkdownFile(plugin: ConfluenceObsidianSyncPlugin, path: string): Promise<void> {
  for (let attemptCount = 0; attemptCount < 5; attemptCount += 1) {
    const file = plugin.app.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      await plugin.app.workspace.getLeaf(false).openFile(file);
      return;
    }

    await delay(100);
  }

  new Notice(`Pull 리포트가 생성되었습니다: ${path}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
