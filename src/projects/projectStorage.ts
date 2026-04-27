import type { ConfluenceProjectManifest, ProjectPaths, RootContentType } from "./projectManifest";

export interface ProjectStorageAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

export interface WriteProjectManifestSuccess {
  ok: true;
  manifestPath: string;
}

export interface WriteProjectManifestFailure {
  ok: false;
  reason: "manifest-already-exists" | "storage-error";
  message: string;
}

export type WriteProjectManifestResult = WriteProjectManifestSuccess | WriteProjectManifestFailure;

function buildManifestAlreadyExistsFailure(): WriteProjectManifestFailure {
  return {
    ok: false,
    reason: "manifest-already-exists",
    message: "이미 프로젝트 manifest가 존재합니다. 기존 프로젝트를 덮어쓰지 않습니다."
  };
}

function buildStorageErrorFailure(): WriteProjectManifestFailure {
  return {
    ok: false,
    reason: "storage-error",
    message: "로컬 프로젝트 폴더 또는 manifest를 생성할 수 없습니다."
  };
}

function createManifestContent(manifest: ConfluenceProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function ensureFolderExists(storage: ProjectStorageAdapter, path: string): Promise<void> {
  const folderExists = await storage.exists(path);

  if (!folderExists) {
    await storage.mkdir(path);
  }
}

export async function writeProjectManifest(
  storage: ProjectStorageAdapter,
  paths: ProjectPaths,
  manifest: ConfluenceProjectManifest
): Promise<WriteProjectManifestResult> {
  try {
    // 같은 프로젝트 manifest는 설정 저장 실패 뒤 재시도할 수 있도록 최신 내용으로 갱신한다.
    if (await storage.exists(paths.manifestPath)) {
      return await updateExistingProjectManifest(storage, paths.manifestPath, manifest);
    }

    await ensureFolderExists(storage, paths.projectRootPath);
    await ensureFolderExists(storage, paths.manifestFolderPath);

    // 폴더 생성 중 manifest가 생긴 경우에도 덮어쓰지 않는다.
    if (await storage.exists(paths.manifestPath)) {
      return await updateExistingProjectManifest(storage, paths.manifestPath, manifest);
    }

    await storage.write(paths.manifestPath, createManifestContent(manifest));

    return {
      ok: true,
      manifestPath: paths.manifestPath
    };
  } catch {
    return buildStorageErrorFailure();
  }
}

async function updateExistingProjectManifest(
  storage: ProjectStorageAdapter,
  manifestPath: string,
  manifest: ConfluenceProjectManifest
): Promise<WriteProjectManifestResult> {
  const existingManifestIdentity = parseExistingProjectManifestIdentity(await storage.read(manifestPath));

  if (existingManifestIdentity !== null && isSameProjectManifest(existingManifestIdentity, manifest)) {
    await storage.write(manifestPath, createManifestContent(manifest));

    return {
      ok: true,
      manifestPath
    };
  }

  return buildManifestAlreadyExistsFailure();
}

interface ExistingProjectManifestIdentity {
  confluenceBaseUrl: string;
  rootContentType: RootContentType;
  rootContentId: string;
  localRootFolder: string;
}

function parseExistingProjectManifestIdentity(rawManifest: string): ExistingProjectManifestIdentity | null {
  try {
    const parsedManifest = JSON.parse(rawManifest) as Partial<ConfluenceProjectManifest>;

    const rootIdentity = readExistingRootIdentity(parsedManifest);

    if (
      rootIdentity !== null &&
      typeof parsedManifest.localRootFolder === "string" &&
      typeof parsedManifest.confluenceBaseUrl === "string"
    ) {
      return {
        confluenceBaseUrl: parsedManifest.confluenceBaseUrl,
        rootContentType: rootIdentity.rootContentType,
        rootContentId: rootIdentity.rootContentId,
        localRootFolder: parsedManifest.localRootFolder
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isSameProjectManifest(
  existingManifest: ExistingProjectManifestIdentity,
  manifest: ConfluenceProjectManifest
): boolean {
  return (
    existingManifest.confluenceBaseUrl === manifest.confluenceBaseUrl &&
    existingManifest.rootContentType === manifest.rootContentType &&
    existingManifest.rootContentId === manifest.rootContentId &&
    existingManifest.localRootFolder === manifest.localRootFolder
  );
}

function readExistingRootIdentity(
  parsedManifest: Partial<ConfluenceProjectManifest>
): Pick<ExistingProjectManifestIdentity, "rootContentType" | "rootContentId"> | null {
  if (
    (parsedManifest.rootContentType === "page" || parsedManifest.rootContentType === "folder") &&
    typeof parsedManifest.rootContentId === "string"
  ) {
    return {
      rootContentType: parsedManifest.rootContentType,
      rootContentId: parsedManifest.rootContentId
    };
  }

  // 이전 manifest는 page 프로젝트만 저장했으므로 rootPageId를 page rootContentId로 승격한다.
  if (typeof parsedManifest.rootPageId === "string") {
    return {
      rootContentType: "page",
      rootContentId: parsedManifest.rootPageId
    };
  }

  return null;
}
