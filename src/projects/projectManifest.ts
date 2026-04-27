export type RootContentType = "page" | "folder";

export interface ConfluenceProjectManifest {
  manifestVersion: 1;
  projectName: string;
  confluenceBaseUrl: string;
  spaceId: string;
  rootContentType: RootContentType;
  rootContentId: string;
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
  rootContentType: RootContentType;
  rootContentId: string;
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

export function createSafeProjectFolderName(title: string, fallbackFolderName = "confluence-page-unknown"): string {
  const sanitizedTitle = title.replace(/[<>:"/\\|?*]+/gu, " ");
  const normalizedTitle = sanitizedTitle.replace(/\s+/gu, " ").trim();

  if (normalizedTitle.length > 0 && normalizedTitle !== "." && normalizedTitle !== "..") {
    return normalizedTitle;
  }

  return fallbackFolderName;
}

export function buildProjectPaths(
  defaultProjectFolder: string,
  projectName: string,
  rootContentId: string,
  rootContentType: RootContentType = "page",
  collisionIndex = 0
): ProjectPaths {
  const normalizedDefaultFolder = normalizeVaultFolderPath(defaultProjectFolder);
  const fallbackFolderName = createStableProjectFolderName(rootContentId, rootContentType);
  const safeProjectFolderName = createSafeProjectFolderName(projectName, fallbackFolderName);
  const projectFolderName = appendCollisionSuffix(safeProjectFolderName, collisionIndex);
  const projectRootPath = joinVaultPath(normalizedDefaultFolder, projectFolderName);
  const manifestFolderPath = joinVaultPath(projectRootPath, ".confluence-sync");
  const manifestPath = joinVaultPath(manifestFolderPath, "manifest.json");

  return {
    projectRootPath,
    manifestFolderPath,
    manifestPath
  };
}

export function buildProjectManifest(input: BuildProjectManifestInput): ConfluenceProjectManifest {
  const rootPageId = input.rootContentType === "page" ? input.rootContentId : "";

  // createdAt와 updatedAt을 동일하게 두어 생성 시점이 결정적으로 유지되도록 한다.
  return {
    manifestVersion: 1,
    projectName: input.projectName,
    confluenceBaseUrl: input.confluenceBaseUrl,
    spaceId: input.spaceId,
    rootContentType: input.rootContentType,
    rootContentId: input.rootContentId,
    rootPageId,
    rootUrl: input.rootUrl,
    localRootFolder: input.localFolderPath,
    localFolderPath: input.localFolderPath,
    lastPulledAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function createStableProjectFolderName(rootContentId: string, rootContentType: RootContentType): string {
  return `confluence-${rootContentType}-${rootContentId}`;
}

function appendCollisionSuffix(folderName: string, collisionIndex: number): string {
  if (collisionIndex <= 0) {
    return folderName;
  }

  return `${folderName} (${collisionIndex})`;
}

function joinVaultPath(...segments: string[]): string {
  return segments.filter((segment) => segment.length > 0).join("/");
}
