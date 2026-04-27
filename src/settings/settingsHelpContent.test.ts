import { describe, expect, it } from "vitest";
import {
  ATLASSIAN_API_TOKEN_URL,
  SYNC_PANEL_OPEN_GUIDE_TEXT
} from "./settingsHelpContent";

describe("settings help content", () => {
  it("provides the official Atlassian API token URL", () => {
    expect(ATLASSIAN_API_TOKEN_URL).toBe("https://id.atlassian.com/manage-profile/security/api-tokens");
  });

  it("explains how to open the Sync Panel from Obsidian", () => {
    expect(SYNC_PANEL_OPEN_GUIDE_TEXT).toContain("명령 팔레트");
    expect(SYNC_PANEL_OPEN_GUIDE_TEXT).toContain("Open Sync Panel");
  });
});
