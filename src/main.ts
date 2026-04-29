import { Notice, Plugin, type TFile } from "obsidian";
import {
  FORCE_PULL_TREE_COMMAND_ID,
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_CURRENT_PAGE_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID
} from "./commands/commandIds";
import { runPullCurrentPageCommand } from "./commands/pullCurrentPageCommand";
import { runPullTreeCommand } from "./commands/pullTreeCommand";
import { runPushCurrentPageCommand } from "./commands/pushCurrentPageCommand";
import { buildPullReportPath } from "./projects/pullReport";
import type { ProjectStorageAdapter } from "./projects/projectStorage";
import { ConfluenceSyncSettingTab } from "./settings/ConfluenceSyncSettingTab";
import {
  DEFAULT_CONFLUENCE_SYNC_SETTINGS,
  loadConfluenceSyncSettings,
  type ConfluenceSyncSettings
} from "./settings/defaultSettings";
import { chooseSyncPanelLeaf } from "./views/syncPanelIntegration";
import { registerSyncPanelRibbonIcon } from "./views/syncPanelRibbon";
import { buildSyncPanelState } from "./views/syncPanelState";
import { SYNC_PANEL_VIEW_TYPE, SyncPanelView } from "./views/syncPanelView";
import { openVaultMarkdownFileFromObsidian } from "./views/openVaultMarkdownFile";

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
            onForcePullTree: () => this.runForcePullTree(),
            onPullCurrentPage: () => this.pullCurrentPage(),
            onPushCurrentPage: () => this.pushCurrentPage(),
            onOpenRootLink: () => this.openCurrentProjectRootLink(),
            onOpenLatestReport: () => this.openCurrentProjectLatestReport()
          }
        })
    );
    registerSyncPanelRibbonIcon({
      addRibbonIcon: (icon, title, callback) => this.addRibbonIcon(icon, title, callback),
      openSyncPanel: () => this.openSyncPanel()
    });
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
      id: FORCE_PULL_TREE_COMMAND_ID,
      name: "Force Pull Tree",
      callback: () => {
        void this.runForcePullTree();
      }
    });

    this.addCommand({
      id: PULL_CURRENT_PAGE_COMMAND_ID,
      name: "Pull Current Page",
      callback: () => {
        void this.pullCurrentPage();
      }
    });

    this.addCommand({
      id: PUSH_CURRENT_PAGE_COMMAND_ID,
      name: "Push Current Page",
      callback: () => {
        void this.pushCurrentPage();
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

    await this.app.workspace.revealLeaf(leaf);
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

  private async runForcePullTree(): Promise<void> {
    await runPullTreeCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      mode: "force",
      confirmForcePull: (message) => window.confirm(message),
      showNotice: (message) => new Notice(message),
      openReport: (path) => openVaultMarkdownFile(this, path)
    });

    await this.refreshSyncPanelViews();
  }

  private async pullCurrentPage(): Promise<void> {
    await runPullCurrentPageCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      getActiveMarkdownFile: () => {
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile === null || activeFile.extension !== "md") {
          return null;
        }

        return { path: activeFile.path };
      },
      showNotice: (message) => new Notice(message)
    });

    await this.refreshSyncPanelViews();
  }

  private async pushCurrentPage(): Promise<void> {
    await runPushCurrentPageCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      getActiveMarkdownFile: () => {
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile === null || activeFile.extension !== "md") {
          return null;
        }

        return { path: activeFile.path };
      },
      showNotice: (message) => new Notice(message)
    });

    await this.refreshSyncPanelViews();
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
  await openVaultMarkdownFileFromObsidian<TFile>(
    {
      getFileByPath: (filePath) => plugin.app.vault.getFileByPath(filePath),
      fileExists: (filePath) => plugin.app.vault.adapter.exists(filePath),
      openFileInNewTab: async (file) => {
        const leaf = plugin.app.workspace.getLeaf("tab");

        await leaf.openFile(file, { active: true });
        await plugin.app.workspace.revealLeaf(leaf);
      },
      openPathInNewTab: (filePath) => plugin.app.workspace.openLinkText(filePath, "", "tab", { active: true }),
      showNotice: (message) => new Notice(message),
      wait: delay
    },
    path
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
