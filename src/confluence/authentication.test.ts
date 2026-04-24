import { describe, expect, it } from "vitest";
import {
  buildBasicAuthorizationHeader,
  buildConfluenceApiUrl,
  getConfluenceApiBaseUrl,
  getMissingConfluenceConnectionFields
} from "./authentication";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

function createSettings(overrides: Partial<ConfluenceSyncSettings> = {}): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    currentProject: null,
    ...overrides
  };
}

describe("getMissingConfluenceConnectionFields", () => {
  it("returns no missing fields when required connection settings exist", () => {
    const missingFields = getMissingConfluenceConnectionFields(createSettings());

    expect(missingFields).toEqual([]);
  });

  it("returns Korean labels for empty required connection settings", () => {
    const missingFields = getMissingConfluenceConnectionFields(
      createSettings({
        confluenceBaseUrl: "   ",
        userEmail: "",
        apiToken: "   "
      })
    );

    expect(missingFields).toEqual(["Confluence base URL", "Atlassian account email", "API token"]);
  });

  it("treats malformed persisted values as missing fields", () => {
    const missingFields = getMissingConfluenceConnectionFields(
      createSettings({
        confluenceBaseUrl: null as unknown as string,
        userEmail: 123 as unknown as string,
        apiToken: undefined as unknown as string
      })
    );

    expect(missingFields).toEqual(["Confluence base URL", "Atlassian account email", "API token"]);
  });
});

describe("getConfluenceApiBaseUrl", () => {
  it("normalizes equivalent Confluence base URL forms to the tenant origin", () => {
    expect(getConfluenceApiBaseUrl("https://selta.atlassian.net/wiki")).toBe("https://selta.atlassian.net");
    expect(getConfluenceApiBaseUrl("https://selta.atlassian.net/")).toBe("https://selta.atlassian.net");
  });
});

describe("buildBasicAuthorizationHeader", () => {
  it("builds a Basic authorization header from email and API token", () => {
    const header = buildBasicAuthorizationHeader("owner@example.com", "secret-token");

    expect(header).toBe("Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu");
  });

  it("trims accidental whitespace around credentials", () => {
    const header = buildBasicAuthorizationHeader(" owner@example.com ", " secret-token ");

    expect(header).toBe("Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu");
  });
});

describe("buildConfluenceApiUrl", () => {
  it("joins the normalized base URL and REST path", () => {
    const url = buildConfluenceApiUrl("https://selta.atlassian.net/", "/wiki/rest/api/user/current");

    expect(url).toBe("https://selta.atlassian.net/wiki/rest/api/user/current");
  });

  it("does not duplicate the wiki segment when the base URL already includes it", () => {
    const url = buildConfluenceApiUrl("https://selta.atlassian.net/wiki", "/wiki/api/v2/pages/123456789");

    expect(url).toBe("https://selta.atlassian.net/wiki/api/v2/pages/123456789");
  });

  it("adds a leading slash to the REST path when omitted", () => {
    const url = buildConfluenceApiUrl("https://selta.atlassian.net", "wiki/rest/api/user/current");

    expect(url).toBe("https://selta.atlassian.net/wiki/rest/api/user/current");
  });
});
