export interface ConfluenceSyncSettings {
  confluenceBaseUrl: string;
  userEmail: string;
  apiToken: string;
  defaultProjectFolder: string;
  safeDeleteFolder: string;
}

export const DEFAULT_CONFLUENCE_BASE_URL = "https://selta.atlassian.net";

export const DEFAULT_CONFLUENCE_SYNC_SETTINGS: ConfluenceSyncSettings = {
  confluenceBaseUrl: DEFAULT_CONFLUENCE_BASE_URL,
  userEmail: "",
  apiToken: "",
  defaultProjectFolder: "confluence",
  safeDeleteFolder: ".confluence-sync/trash"
};

export function normalizeConfluenceBaseUrl(rawBaseUrl: string): string {
  const trimmedBaseUrl = rawBaseUrl.trim();

  if (trimmedBaseUrl.length === 0) {
    return DEFAULT_CONFLUENCE_BASE_URL;
  }

  return trimmedBaseUrl.replace(/\/+$/u, "");
}
