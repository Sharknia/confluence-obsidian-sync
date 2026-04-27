import type { RootContentType } from "../projects/projectManifest";

export interface CurrentConfluenceProjectSettings {
  projectName: string;
  spaceId: string;
  rootContentType: RootContentType;
  rootContentId: string;
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
    const storedSettingsRecord = isObjectRecord(storedSettings) ? storedSettings : {};

    return {
      ...DEFAULT_CONFLUENCE_SYNC_SETTINGS,
      ...storedSettingsRecord,
      currentProject: normalizeCurrentProjectSettings(storedSettingsRecord.currentProject)
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

function normalizeCurrentProjectSettings(rawCurrentProject: unknown): CurrentConfluenceProjectSettings | null {
  if (!isCurrentProjectRecord(rawCurrentProject)) {
    return null;
  }

  const rootContentType =
    rawCurrentProject.rootContentType === "folder" || rawCurrentProject.rootContentType === "page"
      ? rawCurrentProject.rootContentType
      : "page";
  const storedRootContentId =
    typeof rawCurrentProject.rootContentId === "string" && rawCurrentProject.rootContentId.trim().length > 0
      ? rawCurrentProject.rootContentId
      : null;

  if (rootContentType === "folder" && storedRootContentId === null) {
    return null;
  }

  const rootContentId = storedRootContentId ?? rawCurrentProject.rootPageId;

  return {
    projectName: rawCurrentProject.projectName,
    spaceId: rawCurrentProject.spaceId,
    rootContentType,
    rootContentId,
    rootPageId: rawCurrentProject.rootPageId,
    rootUrl: rawCurrentProject.rootUrl,
    localFolderPath: rawCurrentProject.localFolderPath,
    manifestPath: rawCurrentProject.manifestPath
  };
}

function isCurrentProjectRecord(value: unknown): value is {
  projectName: string;
  spaceId: string;
  rootContentType?: unknown;
  rootContentId?: unknown;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
  manifestPath: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const currentProject = value as Record<string, unknown>;

  return (
    typeof currentProject.projectName === "string" &&
    typeof currentProject.spaceId === "string" &&
    typeof currentProject.rootPageId === "string" &&
    typeof currentProject.rootUrl === "string" &&
    typeof currentProject.localFolderPath === "string" &&
    typeof currentProject.manifestPath === "string"
  );
}
