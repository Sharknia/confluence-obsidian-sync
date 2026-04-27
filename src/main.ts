import { Notice, Plugin } from "obsidian";
import {
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID
} from "./commands/commandIds";
import { runPullTreeCommand } from "./commands/pullTreeCommand";
import type { ProjectStorageAdapter } from "./projects/projectStorage";
import { ConfluenceSyncSettingTab } from "./settings/ConfluenceSyncSettingTab";
import {
  DEFAULT_CONFLUENCE_SYNC_SETTINGS,
  loadConfluenceSyncSettings,
  type ConfluenceSyncSettings
} from "./settings/defaultSettings";

export default class ConfluenceObsidianSyncPlugin extends Plugin {
  settings: ConfluenceSyncSettings = { ...DEFAULT_CONFLUENCE_SYNC_SETTINGS };

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ConfluenceSyncSettingTab(this));
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
        new Notice("Confluence Sync Panel은 다음 Epic에서 구현됩니다.");
      }
    });

    this.addCommand({
      id: PULL_TREE_COMMAND_ID,
      name: "Pull Tree",
      callback: () => {
        void runPullTreeCommand({
          settings: this.settings,
          storage: createVaultStorageAdapter(this),
          showNotice: (message) => new Notice(message)
        });
      }
    });

    this.addCommand({
      id: PUSH_CURRENT_PAGE_COMMAND_ID,
      name: "Push Current Page",
      callback: () => {
        new Notice("Confluence Push Current Page는 단일 문서 업로드 Epic에서 구현됩니다.");
      }
    });
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
