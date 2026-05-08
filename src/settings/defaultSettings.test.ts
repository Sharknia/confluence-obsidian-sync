import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFLUENCE_SYNC_SETTINGS,
  DEFAULT_ROOT_CONTENT_URL,
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

  it("uses the IS Confluence folder as the initial root content URL", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.defaultRootContentUrl).toBe(DEFAULT_ROOT_CONTENT_URL);
  });

  it("keeps the safe delete folder under the sync metadata folder", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.safeDeleteFolder).toBe(".confluence-sync/trash");
  });

  it("keeps graphify executable path blank by default", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.graphifyExecutablePath).toBe("");
  });

  it("uses a ten minute graphify timeout by default", () => {
    expect(DEFAULT_CONFLUENCE_SYNC_SETTINGS.graphifyTimeoutSeconds).toBe(600);
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

  it("loads a stored graphify executable path after trimming whitespace", async () => {
    const settings = await loadConfluenceSyncSettings(() =>
      Promise.resolve({
        graphifyExecutablePath: "  /opt/homebrew/bin/graphify  "
      })
    );

    expect(settings.graphifyExecutablePath).toBe("/opt/homebrew/bin/graphify");
  });

  it("loads a stored default root content URL after trimming whitespace", async () => {
    const settings = await loadConfluenceSyncSettings(() =>
      Promise.resolve({
        defaultRootContentUrl: "  https://selta.atlassian.net/wiki/spaces/IS/folder/23167000  "
      })
    );

    expect(settings.defaultRootContentUrl).toBe("https://selta.atlassian.net/wiki/spaces/IS/folder/23167000");
  });

  it("keeps the default root content URL when stored settings do not include one", async () => {
    const settings = await loadConfluenceSyncSettings(() => Promise.resolve({}));

    expect(settings.defaultRootContentUrl).toBe(DEFAULT_ROOT_CONTENT_URL);
  });

  it("normalizes a non-string stored default root content URL to the default URL", async () => {
    const settings = await loadConfluenceSyncSettings(() =>
      Promise.resolve({
        defaultRootContentUrl: 123
      })
    );

    expect(settings.defaultRootContentUrl).toBe(DEFAULT_ROOT_CONTENT_URL);
  });

  it("normalizes a non-string stored graphify executable path to blank", async () => {
    const settings = await loadConfluenceSyncSettings(() =>
      Promise.resolve({
        graphifyExecutablePath: 123
      })
    );

    expect(settings.graphifyExecutablePath).toBe("");
  });

  it("migrates a stored page current project without root content fields", async () => {
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

    expect(settings.currentProject).toEqual({
      ...storedSettings.currentProject,
      rootContentType: "page",
      rootContentId: "12345"
    });
  });

  it("loads a stored folder current project exactly", async () => {
    const storedSettings = {
      currentProject: {
        projectName: "Current Folder",
        spaceId: "SPACE-1",
        rootContentType: "folder" as const,
        rootContentId: "987654321",
        rootPageId: "",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/folders/987654321",
        localFolderPath: "/Users/crobat/vault/confluence/current-folder",
        manifestPath: "/Users/crobat/vault/confluence/current-folder/.confluence-sync/manifest.json"
      }
    };

    const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

    expect(settings.currentProject).toEqual(storedSettings.currentProject);
  });

  it("normalizes a stored folder current project with an empty root content ID to null", async () => {
    const storedSettings = {
      currentProject: {
        projectName: "Current Folder",
        spaceId: "SPACE-1",
        rootContentType: "folder" as const,
        rootContentId: "",
        rootPageId: "12345",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/folders/987654321",
        localFolderPath: "/Users/crobat/vault/confluence/current-folder",
        manifestPath: "/Users/crobat/vault/confluence/current-folder/.confluence-sync/manifest.json"
      }
    };

    const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

    expect(settings.currentProject).toBeNull();
  });

  it("normalizes a stored folder current project without a root content ID to null", async () => {
    const storedSettings = {
      currentProject: {
        projectName: "Current Folder",
        spaceId: "SPACE-1",
        rootContentType: "folder" as const,
        rootPageId: "12345",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/folders/987654321",
        localFolderPath: "/Users/crobat/vault/confluence/current-folder",
        manifestPath: "/Users/crobat/vault/confluence/current-folder/.confluence-sync/manifest.json"
      }
    };

    const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

    expect(settings.currentProject).toBeNull();
  });

  it("normalizes a stored folder current project with a blank root content ID to null", async () => {
    const storedSettings = {
      currentProject: {
        projectName: "Current Folder",
        spaceId: "SPACE-1",
        rootContentType: "folder" as const,
        rootContentId: "   ",
        rootPageId: "12345",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/folders/987654321",
        localFolderPath: "/Users/crobat/vault/confluence/current-folder",
        manifestPath: "/Users/crobat/vault/confluence/current-folder/.confluence-sync/manifest.json"
      }
    };

    const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

    expect(settings.currentProject).toBeNull();
  });
});
