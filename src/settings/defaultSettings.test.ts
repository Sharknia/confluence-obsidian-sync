import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFLUENCE_SYNC_SETTINGS,
  loadConfluenceSyncSettings,
  normalizeConfluenceBaseUrl
} from "./defaultSettings";

describe("DEFAULT_CONFLUENCE_SYNC_SETTINGS", () => {
  it("uses the SELTA Confluence Cloud base URL as the initial value", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.confluenceBaseUrl).toBe("https://selta.atlassian.net");
  });

  it("keeps the default project folder inside the vault", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.defaultProjectFolder).toBe("confluence");
  });

  it("keeps the safe delete folder under the sync metadata folder", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.safeDeleteFolder).toBe(".confluence-sync/trash");
  });
});

describe("normalizeConfluenceBaseUrl", () => {
  it("removes trailing slashes from the base URL", () => {
    expect(normalizeConfluenceBaseUrl("https://selta.atlassian.net///")).toBe("https://selta.atlassian.net");
  });

  it("returns the default base URL when the value is blank", () => {
    expect(normalizeConfluenceBaseUrl("   ")).toBe("https://selta.atlassian.net");
  });
});

describe("loadConfluenceSyncSettings", () => {
  it("falls back to default settings when stored settings cannot be loaded", async () => {
    const settings = await loadConfluenceSyncSettings(() => Promise.reject(new Error("Failed to load plugin data")));

    expect(settings).toEqual(DEFAULT_CONFLUENCE_SYNC_SETTINGS);
  });

  it("loads stored current project exactly", async () => {
    const storedSettings = {
      currentProject: {
        projectName: "Current Project",
        spaceId: "SPACE-1",
        rootPageId: "12345",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/pages/12345",
        localFolderPath: "/Users/crobat/vault/confluence/current-project",
        manifestPath: "/Users/crobat/vault/confluence/current-project/.confluence-sync/manifest.json"
      }
    };

    const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

    expect(settings.currentProject).toEqual(storedSettings.currentProject);
  });
});
