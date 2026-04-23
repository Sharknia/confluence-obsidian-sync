import { describe, expect, it } from "vitest";
import { DEFAULT_CONFLUENCE_SYNC_SETTINGS, normalizeConfluenceBaseUrl } from "./defaultSettings";

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
