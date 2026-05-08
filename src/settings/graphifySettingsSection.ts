import type { ConfluenceSyncSettings } from "./defaultSettings";

interface TextSettingControl {
  setPlaceholder(value: string): TextSettingControl;
  setValue(value: string): TextSettingControl;
  onChange(handler: (value: string) => Promise<void>): TextSettingControl;
}

interface GraphifySettingBuilder {
  setName(name: string): GraphifySettingBuilder;
  setDesc(description: string): GraphifySettingBuilder;
  addText(callback: (text: TextSettingControl) => void): GraphifySettingBuilder;
}

export type GraphifySettingConstructor = new (containerEl: HTMLElement) => GraphifySettingBuilder;

export function appendGraphifySettingsSection({
  containerEl,
  SettingClass,
  settings,
  saveSettings
}: {
  containerEl: HTMLElement;
  SettingClass: GraphifySettingConstructor;
  settings: ConfluenceSyncSettings;
  saveSettings: () => Promise<void>;
}): void {
  new SettingClass(containerEl)
    .setName("Graphify executable path")
    .setDesc("비워두면 PATH의 graphify를 사용합니다. 감지되지 않으면 예: /opt/homebrew/bin/graphify 처럼 실행 파일 경로를 입력하세요.")
    .addText((text) => {
      text
        .setPlaceholder("graphify")
        .setValue(settings.graphifyExecutablePath)
        .onChange(async (value) => {
          settings.graphifyExecutablePath = value.trim();
          await saveSettings();
        });
    });

  new SettingClass(containerEl)
    .setName("Graphify timeout seconds")
    .setDesc("큰 문서 모음 분석을 위해 기본 600초를 사용합니다. 30초 미만 값은 600초로 되돌립니다.")
    .addText((text) => {
      text
        .setPlaceholder("600")
        .setValue(String(settings.graphifyTimeoutSeconds))
        .onChange(async (value) => {
          const parsedValue = Number(value);
          settings.graphifyTimeoutSeconds = Number.isFinite(parsedValue) && parsedValue >= 30 ? parsedValue : 600;
          await saveSettings();
        });
    });
}
