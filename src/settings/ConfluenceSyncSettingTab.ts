import { PluginSettingTab, Setting } from "obsidian";
import type ConfluenceObsidianSyncPlugin from "../main";
import { normalizeConfluenceBaseUrl } from "./defaultSettings";

export class ConfluenceSyncSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ConfluenceObsidianSyncPlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Confluence Obsidian Sync" });
    containerEl.createEl("p", {
      cls: "confluence-sync-setting-description",
      text: "Confluence Cloud 문서를 Obsidian vault 안의 로컬 Markdown 작업 사본으로 가져오기 위한 기본 설정입니다."
    });

    new Setting(containerEl)
      .setName("Confluence base URL")
      .setDesc("예: https://selta.atlassian.net")
      .addText((text) => {
        text
          .setPlaceholder("https://selta.atlassian.net")
          .setValue(this.plugin.settings.confluenceBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.confluenceBaseUrl = normalizeConfluenceBaseUrl(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Atlassian account email")
      .setDesc("Confluence Cloud API token을 발급한 Atlassian 계정 이메일입니다.")
      .addText((text) => {
        text
          .setPlaceholder("name@example.com")
          .setValue(this.plugin.settings.userEmail)
          .onChange(async (value) => {
            this.plugin.settings.userEmail = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("API token")
      .setDesc("MVP에서는 Obsidian 플러그인 설정에 저장합니다. 사내 배포 시 개인 vault 데이터로 취급합니다.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Atlassian API token")
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default project folder")
      .setDesc("Confluence Markdown 산출물을 저장할 vault 내부 폴더입니다.")
      .addText((text) => {
        text
          .setPlaceholder("confluence")
          .setValue(this.plugin.settings.defaultProjectFolder)
          .onChange(async (value) => {
            this.plugin.settings.defaultProjectFolder = value.trim() || "confluence";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Safe delete folder")
      .setDesc("Confluence에서 사라진 문서를 즉시 삭제하지 않고 이동할 vault 내부 폴더입니다.")
      .addText((text) => {
        text
          .setPlaceholder(".confluence-sync/trash")
          .setValue(this.plugin.settings.safeDeleteFolder)
          .onChange(async (value) => {
            this.plugin.settings.safeDeleteFolder = value.trim() || ".confluence-sync/trash";
            await this.plugin.saveSettings();
          });
      });
  }
}
