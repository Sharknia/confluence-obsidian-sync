export interface ConfluenceProjectManifest {
  manifestVersion: 1;
  projectName: string;
  confluenceBaseUrl: string;
  spaceId: string;
  rootPageId: string;
  rootUrl: string;
  localRootFolder: string;
  localFolderPath: string;
  lastPulledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPaths {
  projectRootPath: string;
  manifestFolderPath: string;
  manifestPath: string;
}

export interface BuildProjectManifestInput {
  projectName: string;
  confluenceBaseUrl: string;
  spaceId: string;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
  createdAt: string;
}

export function normalizeVaultFolderPath(rawFolderPath: string): string {
  const trimmedFolderPath = rawFolderPath.trim();

  if (trimmedFolderPath.length === 0) {
    return "confluence";
  }

  const collapsedFolderPath = trimmedFolderPath.replace(/\/+/gu, "/");
  const normalizedFolderPath = collapsedFolderPath.replace(/^\/+|\/+$/gu, "");

  if (normalizedFolderPath.length === 0) {
    return "confluence";
  }

  const folderSegments = normalizedFolderPath.split("/").filter((segment) => segment.length > 0);

  if (folderSegments.some((segment) => segment === "..")) {
    throw new Error("vault 폴더 경로에는 '..'을 사용할 수 없습니다.");
  }

  return folderSegments.join("/");
}

export function createSafeProjectFolderName(title: string, fallbackPageId = "unknown"): string {
  const sanitizedTitle = title.replace(/[<>:"/\\|?*]+/gu, " ");
  const normalizedTitle = sanitizedTitle.replace(/\s+/gu, " ").trim();

  if (normalizedTitle.length > 0 && normalizedTitle !== "." && normalizedTitle !== "..") {
    return normalizedTitle;
  }

  return `confluence-page-${fallbackPageId}`;
}

export function buildProjectPaths(defaultProjectFolder: string, _projectName: string, rootPageId: string): ProjectPaths {
  const normalizedDefaultFolder = normalizeVaultFolderPath(defaultProjectFolder);
  const projectRootPath = joinVaultPath(normalizedDefaultFolder, createStableProjectFolderName(rootPageId));
  const manifestFolderPath = joinVaultPath(projectRootPath, ".confluence-sync");
  const manifestPath = joinVaultPath(manifestFolderPath, "manifest.json");

  return {
    projectRootPath,
    manifestFolderPath,
    manifestPath
  };
}

export function buildProjectManifest(input: BuildProjectManifestInput): ConfluenceProjectManifest {
  // createdAt와 updatedAt을 동일하게 두어 생성 시점이 결정적으로 유지되도록 한다.
  return {
    manifestVersion: 1,
    projectName: input.projectName,
    confluenceBaseUrl: input.confluenceBaseUrl,
    spaceId: input.spaceId,
    rootPageId: input.rootPageId,
    rootUrl: input.rootUrl,
    localRootFolder: input.localFolderPath,
    localFolderPath: input.localFolderPath,
    lastPulledAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function createStableProjectFolderName(rootPageId: string): string {
  return `confluence-page-${rootPageId}`;
}

function joinVaultPath(...segments: string[]): string {
  return segments.filter((segment) => segment.length > 0).join("/");
}
