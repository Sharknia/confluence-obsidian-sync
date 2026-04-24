export interface CurrentConfluenceProjectSettings {
  projectName: string;
  spaceId: string;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
  manifestPath: string;
}

export interface ConfluenceSyncSettings {
  confluenceBaseUrl: string;
  userEmail: string;
  apiToken: string;
  defaultProjectFolder: string;
  safeDeleteFolder: string;
  currentProject: CurrentConfluenceProjectSettings | null;
}

export const DEFAULT_CONFLUENCE_BASE_URL = "https://selta.atlassian.net";

export const DEFAULT_CONFLUENCE_SYNC_SETTINGS: ConfluenceSyncSettings = {
  confluenceBaseUrl: DEFAULT_CONFLUENCE_BASE_URL,
  userEmail: "",
  apiToken: "",
  defaultProjectFolder: "confluence",
  safeDeleteFolder: ".confluence-sync/trash",
  currentProject: null
};

export async function loadConfluenceSyncSettings(loadStoredSettings: () => Promise<unknown>): Promise<ConfluenceSyncSettings> {
  try {
    const storedSettings = await loadStoredSettings();
    return {
      ...DEFAULT_CONFLUENCE_SYNC_SETTINGS,
      ...(isObjectRecord(storedSettings) ? storedSettings : {})
    };
  } catch {
    return { ...DEFAULT_CONFLUENCE_SYNC_SETTINGS };
  }
}

export function normalizeConfluenceBaseUrl(rawBaseUrl: string): string {
  const trimmedBaseUrl = rawBaseUrl.trim();

  if (trimmedBaseUrl.length === 0) {
    return DEFAULT_CONFLUENCE_BASE_URL;
  }

  return trimmedBaseUrl.replace(/\/+$/u, "");
}

function isObjectRecord(value: unknown): value is Partial<ConfluenceSyncSettings> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
