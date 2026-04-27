import type { PageMarkdownFile } from "./pageMarkdown";
import type { PullSyncPlan } from "./pullSyncPolicy";
import type { ConfluenceProjectManifest, ProjectPaths, RootContentType } from "./projectManifest";

export interface ProjectStorageAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  rename(fromPath: string, toPath: string): Promise<void>;
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

export interface WriteMarkdownPagesSuccess {
  ok: true;
  writtenFileCount: number;
}

export interface WriteMarkdownPagesFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type WriteMarkdownPagesResult = WriteMarkdownPagesSuccess | WriteMarkdownPagesFailure;

export interface PullSyncApplySuccess {
  ok: true;
  writtenFileCount: number;
  safeDeletedFileCount: number;
  skippedLocalChangeCount: number;
  unchangedFileCount: number;
}

export interface PullSyncApplyFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type PullSyncApplyResult = PullSyncApplySuccess | PullSyncApplyFailure;

export interface ListProjectMarkdownFilesSuccess {
  ok: true;
  files: Array<{ vaultPath: string; content: string }>;
}

export interface ListProjectMarkdownFilesFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type ListProjectMarkdownFilesResult = ListProjectMarkdownFilesSuccess | ListProjectMarkdownFilesFailure;

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

function buildParentFolderPaths(vaultPath: string): string[] {
  const pathSegments = vaultPath.split("/").filter((segment) => segment.length > 0);
  const parentPathSegments = pathSegments.slice(0, -1);
  const parentFolderPaths: string[] = [];

  for (let index = 0; index < parentPathSegments.length; index += 1) {
    parentFolderPaths.push(parentPathSegments.slice(0, index + 1).join("/"));
  }

  return parentFolderPaths;
}

function buildMarkdownStorageErrorFailure(): WriteMarkdownPagesFailure {
  return {
    ok: false,
    reason: "storage-error",
    message: "Markdown 파일을 저장할 수 없습니다."
  };
}

export async function writeMarkdownPages(
  storage: ProjectStorageAdapter,
  files: PageMarkdownFile[]
): Promise<WriteMarkdownPagesResult> {
  const ensuredFolderPaths = new Set<string>();

  try {
    for (const file of files) {
      for (const parentFolderPath of buildParentFolderPaths(file.vaultPath)) {
        if (ensuredFolderPaths.has(parentFolderPath)) {
          continue;
        }

        // 상위 폴더는 루트부터 자식 방향으로 차례대로 보장한다.
        await ensureFolderExists(storage, parentFolderPath);
        ensuredFolderPaths.add(parentFolderPath);
      }

      await storage.write(file.vaultPath, file.content);
    }

    return {
      ok: true,
      writtenFileCount: files.length
    };
  } catch {
    return buildMarkdownStorageErrorFailure();
  }
}

export async function listProjectMarkdownFiles(
  storage: ProjectStorageAdapter,
  projectRootPath: string,
  safeDeleteRootPath: string
): Promise<ListProjectMarkdownFilesResult> {
  const markdownFiles: Array<{ vaultPath: string; content: string }> = [];

  async function visitFolder(folderPath: string): Promise<void> {
    if (isSameOrChildPath(folderPath, safeDeleteRootPath)) {
      return;
    }

    const listedFiles = await storage.list(folderPath);

    for (const filePath of listedFiles.files) {
      if (!filePath.endsWith(".md") || isSameOrChildPath(filePath, safeDeleteRootPath)) {
        continue;
      }

      markdownFiles.push({
        vaultPath: filePath,
        content: await storage.read(filePath)
      });
    }

    for (const childFolderPath of listedFiles.folders) {
      await visitFolder(childFolderPath);
    }
  }

  try {
    await visitFolder(projectRootPath);

    return {
      ok: true,
      files: markdownFiles
    };
  } catch {
    return {
      ok: false,
      reason: "storage-error",
      message: "로컬 Markdown 파일 목록을 읽을 수 없습니다."
    };
  }
}

export async function applyPullSyncPlan(
  storage: ProjectStorageAdapter,
  plan: PullSyncPlan
): Promise<PullSyncApplyResult> {
  try {
    const writeResult = await writeMarkdownPages(storage, plan.filesToWrite);

    if (!writeResult.ok) {
      return buildPullSyncApplyStorageErrorFailure();
    }

    for (const moveOperation of plan.filesToMoveToSafeDelete) {
      const availableToPath = await createAvailableMoveDestinationPath(storage, moveOperation.toPath);

      for (const parentFolderPath of buildParentFolderPaths(availableToPath)) {
        await ensureFolderExists(storage, parentFolderPath);
      }

      await storage.rename(moveOperation.fromPath, availableToPath);
    }

    return {
      ok: true,
      writtenFileCount: plan.filesToWrite.length,
      safeDeletedFileCount: plan.filesToMoveToSafeDelete.length,
      skippedLocalChangeCount: plan.skippedLocalChanges.length,
      unchangedFileCount: plan.unchangedFileCount
    };
  } catch {
    return buildPullSyncApplyStorageErrorFailure();
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

function buildPullSyncApplyStorageErrorFailure(): PullSyncApplyFailure {
  return {
    ok: false,
    reason: "storage-error",
    message: "Pull 결과를 로컬 파일에 적용할 수 없습니다."
  };
}

function isSameOrChildPath(path: string, parentPath: string): boolean {
  const normalizedPath = path.replace(/\/+$/u, "");
  const normalizedParentPath = parentPath.replace(/\/+$/u, "");

  return normalizedPath === normalizedParentPath || normalizedPath.startsWith(`${normalizedParentPath}/`);
}

async function createAvailableMoveDestinationPath(
  storage: ProjectStorageAdapter,
  requestedPath: string
): Promise<string> {
  if (!(await storage.exists(requestedPath))) {
    return requestedPath;
  }

  const extensionIndex = requestedPath.toLocaleLowerCase("en-US").endsWith(".md")
    ? requestedPath.length - ".md".length
    : requestedPath.length;
  const basePath = requestedPath.slice(0, extensionIndex);
  const extension = requestedPath.slice(extensionIndex);
  let collisionIndex = 1;

  while (true) {
    const candidatePath = `${basePath} (${collisionIndex})${extension}`;

    if (!(await storage.exists(candidatePath))) {
      return candidatePath;
    }

    collisionIndex += 1;
  }
}
