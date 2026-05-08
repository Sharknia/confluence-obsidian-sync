import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import type { ConfluenceSyncSettings } from "./defaultSettings";
import { appendGraphifySettingsSection } from "./graphifySettingsSection";

describe("appendGraphifySettingsSection", () => {
  function createSettings(): ConfluenceSyncSettings {
    return {
      confluenceBaseUrl: "https://selta.atlassian.net",
      userEmail: "",
      apiToken: "",
      defaultProjectFolder: "confluence",
      safeDeleteFolder: ".confluence-sync/trash",
      graphifyExecutablePath: "",
      graphifyTimeoutSeconds: 600,
      currentProject: null
    };
  }

  it("saves graphify executable path and normalized timeout from rendered inputs", async () => {
    const { document, window } = parseHTML("<section></section>");
    const containerEl = document.querySelector("section") as HTMLElement;
    const settings = createSettings();
    const saveSettings = vi.fn(async () => {});

    appendGraphifySettingsSection({ containerEl, SettingClass: FakeSetting, settings, saveSettings });
    const inputs = containerEl.querySelectorAll("input");
    inputs[0]?.setAttribute("value", "  /opt/homebrew/bin/graphify  ");
    inputs[0]?.dispatchEvent(new window.Event("change"));
    inputs[1]?.setAttribute("value", "10");
    inputs[1]?.dispatchEvent(new window.Event("change"));
    await Promise.resolve();

    expect(settings.graphifyExecutablePath).toBe("/opt/homebrew/bin/graphify");
    expect(settings.graphifyTimeoutSeconds).toBe(600);
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });
});

class FakeSetting {
  constructor(private readonly containerEl: HTMLElement) {}

  setName(name: string): this {
    this.containerEl.append(this.containerEl.ownerDocument.createTextNode(name));
    return this;
  }

  setDesc(description: string): this {
    this.containerEl.append(this.containerEl.ownerDocument.createTextNode(description));
    return this;
  }

  addText(
    callback: (text: {
      setPlaceholder: (value: string) => unknown;
      setValue: (value: string) => unknown;
      onChange: (handler: (value: string) => Promise<void>) => unknown;
    }) => void
  ): this {
    const inputEl = this.containerEl.ownerDocument.createElement("input");
    const textControl = {
      setPlaceholder: (value: string) => {
        inputEl.setAttribute("placeholder", value);
        return textControl;
      },
      setValue: (value: string) => {
        inputEl.setAttribute("value", value);
        return textControl;
      },
      onChange: (handler: (value: string) => Promise<void>) => {
        inputEl.addEventListener("change", () => {
          void handler(inputEl.getAttribute("value") ?? "");
        });
        return textControl;
      }
    };
    callback(textControl);
    this.containerEl.append(inputEl);
    return this;
  }
}
