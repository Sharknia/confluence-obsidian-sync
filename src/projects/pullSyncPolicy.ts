import {
  calculateMarkdownBodyHash,
  parsePageMarkdownMetadata,
  type PageMarkdownFile,
  type ParsedPageMarkdownMetadata,
} from "./pageMarkdown";

export interface LocalMarkdownFileSnapshot {
  vaultPath: string;
  content: string;
}

export interface LocalMarkdownPageFile extends LocalMarkdownFileSnapshot {
  pageId: string;
  metadata: ParsedPageMarkdownMetadata;
  hasLocalChanges: boolean;
}

export interface PageMarkdownFileWriteOperation extends PageMarkdownFile {
  operation: "create" | "update";
}

export interface SafeDeleteMoveOperation {
  fromPath: string;
  toPath: string;
}

export interface PullSyncPlan {
  filesToWrite: PageMarkdownFileWriteOperation[];
  filesToMoveToSafeDelete: SafeDeleteMoveOperation[];
  skippedLocalChanges: LocalMarkdownPageFile[];
  unchangedFileCount: number;
}

export interface CreatePullSyncPlanInput {
  projectRootPath: string;
  safeDeleteRootPath: string;
  remoteFiles: PageMarkdownFile[];
  localFiles: LocalMarkdownFileSnapshot[];
}

export function createPullSyncPlan(input: CreatePullSyncPlanInput): PullSyncPlan {
  const localPageFiles = input.localFiles
    .map(toLocalMarkdownPageFile)
    .filter((file): file is LocalMarkdownPageFile => file !== null)
    .filter((file) => !isInsideSafeDeleteFolder(file.vaultPath, input.safeDeleteRootPath));
  const { localFilesByPageId, duplicateLocalFiles } = indexLocalFilesByPageId(localPageFiles);
  const remotePageIds = new Set(input.remoteFiles.map((file) => file.pageId));
  const filesToWrite: PageMarkdownFileWriteOperation[] = [];
  const filesToMoveToSafeDelete: SafeDeleteMoveOperation[] = [];
  const skippedLocalChanges: LocalMarkdownPageFile[] = [...duplicateLocalFiles];
  let unchangedFileCount = 0;

  for (const remoteFile of input.remoteFiles) {
    const localFile = localFilesByPageId.get(remoteFile.pageId);

    if (localFile === undefined) {
      filesToWrite.push({ ...remoteFile, operation: "create" });
      continue;
    }

    if (!canReplaceLocalFile(localFile, remoteFile)) {
      skippedLocalChanges.push(localFile);
      continue;
    }

    if (localFile.content === remoteFile.content) {
      unchangedFileCount += 1;
      continue;
    }

    filesToWrite.push({ ...remoteFile, vaultPath: localFile.vaultPath, operation: "update" });
  }

  for (const localFile of localPageFiles) {
    if (remotePageIds.has(localFile.pageId) || duplicateLocalFiles.includes(localFile)) {
      continue;
    }

    if (localFile.hasLocalChanges) {
      skippedLocalChanges.push(localFile);
      continue;
    }

    filesToMoveToSafeDelete.push({
      fromPath: localFile.vaultPath,
      toPath: buildSafeDeletePath(input.projectRootPath, input.safeDeleteRootPath, localFile.vaultPath),
    });
  }

  return {
    filesToWrite,
    filesToMoveToSafeDelete,
    skippedLocalChanges,
    unchangedFileCount,
  };
}

function indexLocalFilesByPageId(localPageFiles: LocalMarkdownPageFile[]): {
  localFilesByPageId: Map<string, LocalMarkdownPageFile>;
  duplicateLocalFiles: LocalMarkdownPageFile[];
} {
  const localFilesByPageId = new Map<string, LocalMarkdownPageFile>();
  const duplicateLocalFiles: LocalMarkdownPageFile[] = [];

  for (const localFile of localPageFiles) {
    if (localFilesByPageId.has(localFile.pageId)) {
      duplicateLocalFiles.push(localFile);
      continue;
    }

    localFilesByPageId.set(localFile.pageId, localFile);
  }

  return { localFilesByPageId, duplicateLocalFiles };
}

function toLocalMarkdownPageFile(file: LocalMarkdownFileSnapshot): LocalMarkdownPageFile | null {
  const metadata = parsePageMarkdownMetadata(file.content);

  if (metadata === null) {
    return null;
  }

  return {
    ...file,
    pageId: metadata.pageId,
    metadata,
    hasLocalChanges: hasLocalMarkdownBodyChanged(metadata),
  };
}

function hasLocalMarkdownBodyChanged(metadata: ParsedPageMarkdownMetadata): boolean {
  if (metadata.contentHash === null) {
    return false;
  }

  return calculateMarkdownBodyHash(metadata.bodyMarkdown) !== metadata.contentHash;
}

function canReplaceLocalFile(localFile: LocalMarkdownPageFile, remoteFile: PageMarkdownFile): boolean {
  if (localFile.metadata.contentHash !== null) {
    return !localFile.hasLocalChanges;
  }

  const remoteMetadata = parsePageMarkdownMetadata(remoteFile.content);

  if (remoteMetadata === null) {
    return false;
  }

  // hash가 없는 기존 Pull 산출물은 본문이 동일할 때만 hash 추가 갱신을 허용한다.
  return localFile.metadata.bodyMarkdown === remoteMetadata.bodyMarkdown;
}

function buildSafeDeletePath(projectRootPath: string, safeDeleteRootPath: string, originalPath: string): string {
  const relativePath = removePathPrefix(originalPath, projectRootPath);

  return joinVaultPath(safeDeleteRootPath, relativePath);
}

function removePathPrefix(path: string, prefix: string): string {
  if (path === prefix) {
    return "";
  }

  const normalizedPrefix = `${prefix.replace(/\/+$/u, "")}/`;

  return path.startsWith(normalizedPrefix) ? path.slice(normalizedPrefix.length) : path.split("/").pop() ?? path;
}

function isInsideSafeDeleteFolder(path: string, safeDeleteRootPath: string): boolean {
  const normalizedSafeDeleteRootPath = safeDeleteRootPath.replace(/\/+$/u, "");

  return path === normalizedSafeDeleteRootPath || path.startsWith(`${normalizedSafeDeleteRootPath}/`);
}

function joinVaultPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}
