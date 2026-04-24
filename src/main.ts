import { Notice, Plugin } from "obsidian";
import { getMissingConfluenceConnectionFields } from "./confluence/authentication";
import {
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID
} from "./commands/commandIds";
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
        const missingFields = getMissingConfluenceConnectionFields(this.settings);

        if (missingFields.length > 0) {
          new Notice(`Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields.join(", ")}`);
          return;
        }

        const currentProject = this.settings.currentProject;

        if (currentProject === null) {
          new Notice("Pull Tree 실행 전에 설정 화면에서 루트 페이지 기반 프로젝트를 생성하세요.");
          return;
        }

        new Notice("Pull Tree는 페이지 트리 Pull Epic에서 구현됩니다.");
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
