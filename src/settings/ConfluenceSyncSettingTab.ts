import { Notice, PluginSettingTab, Setting } from "obsidian";
import { checkConfluenceConnection } from "../confluence/connectionCheck";
import { createObsidianRequestTransport } from "../confluence/obsidianRequestTransport";
import { createProjectFromRootUrl } from "../projects/createProjectFromRootUrl";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
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

    let rootContentUrl = this.plugin.settings.currentProject?.rootUrl ?? "";

    const currentProjectStatusEl = containerEl.createEl("p", {
      cls: "confluence-sync-current-project-status",
      text: this.buildCurrentProjectStatusText()
    });
    containerEl.createEl("p", {
      cls: "confluence-sync-pull-tree-description",
      text: "Pull Tree는 현재 루트 페이지 기준 Confluence 페이지 트리를 조회하고, Markdown 저장은 다음 Epic에서 연결됩니다."
    });

    const projectCreationStatusEl = containerEl.createEl("p", {
      cls: "confluence-sync-project-creation-status",
      text: "루트 페이지 또는 루트 폴더 기반 프로젝트를 생성할 수 있습니다."
    });

    new Setting(containerEl)
      .setName("Root content URL")
      .setDesc("루트 페이지 또는 루트 폴더 URL로 Confluence 프로젝트를 생성합니다.")
      .addText((text) => {
        text
          .setPlaceholder("https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root")
          .setValue(rootContentUrl)
          .onChange((value) => {
            rootContentUrl = value;
          });
      });

    new Setting(containerEl)
      .setName("Create project")
      .setDesc("루트 페이지 또는 폴더 URL을 기반으로 로컬 프로젝트 manifest와 폴더를 생성합니다.")
      .addButton((button) => {
        button.setButtonText("Create project").onClick(async () => {
          button.setDisabled(true);
          projectCreationStatusEl.setText("Confluence 프로젝트를 생성하는 중입니다...");

          try {
            const result = await createProjectFromRootUrl({
              settings: this.plugin.settings,
              rawRootUrl: rootContentUrl,
              transport: createObsidianRequestTransport,
              storage: createVaultStorageAdapter(this.plugin),
              now: () => new Date()
            });

            if (result.ok) {
              const previousCurrentProject = this.plugin.settings.currentProject;
              this.plugin.settings.currentProject = result.currentProject;

              try {
                await this.plugin.saveSettings();
              } catch (error) {
                this.plugin.settings.currentProject = previousCurrentProject;
                throw error;
              }

              currentProjectStatusEl.setText(this.buildCurrentProjectStatusText());
            }

            projectCreationStatusEl.setText(result.message);
            new Notice(result.message);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Confluence 프로젝트 생성 중 알 수 없는 오류가 발생했습니다.";

            projectCreationStatusEl.setText(message);
            new Notice(message);
          } finally {
            button.setDisabled(false);
          }
        });
      });

    const connectionStatusEl = containerEl.createEl("p", {
      cls: "confluence-sync-connection-status",
      text: "저장된 인증 정보로 Confluence API 접근 여부를 확인할 수 있습니다."
    });

    new Setting(containerEl)
      .setName("Check connection")
      .setDesc("현재 설정으로 Confluence Cloud 현재 사용자 API를 호출합니다.")
      .addButton((button) => {
        button.setButtonText("Check connection").onClick(async () => {
          button.setDisabled(true);
          connectionStatusEl.setText("Confluence 연결을 확인하는 중입니다...");

          try {
            const result = await checkConfluenceConnection(this.plugin.settings, createObsidianRequestTransport);

            connectionStatusEl.setText(result.message);
            new Notice(result.message);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Confluence 연결 확인 중 알 수 없는 오류가 발생했습니다.";
            connectionStatusEl.setText(message);
            new Notice(message);
          } finally {
            button.setDisabled(false);
          }
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

  private buildCurrentProjectStatusText(): string {
    const currentProject = this.plugin.settings.currentProject;

    if (currentProject === null) {
      return "현재 생성된 Confluence 프로젝트가 없습니다.";
    }

    return `현재 프로젝트: ${currentProject.projectName} (${currentProject.localFolderPath})`;
  }
}

function createVaultStorageAdapter(plugin: ConfluenceObsidianSyncPlugin): ProjectStorageAdapter {
  return {
    exists: (path) => plugin.app.vault.adapter.exists(path),
    mkdir: (path) => plugin.app.vault.adapter.mkdir(path),
    read: (path) => plugin.app.vault.adapter.read(path),
    write: (path, data) => plugin.app.vault.adapter.write(path, data)
  };
}
