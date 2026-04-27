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
  skipReason?: PullSyncSkipReason;
}

export type PullSyncSkipReason =
  | "duplicate-page-id"
  | "local-change"
  | "legacy-body-mismatch"
  | "disappeared-local-change";

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
  overwrittenLocalChanges: LocalMarkdownPageFile[];
  unchangedFileCount: number;
}

export interface CreatePullSyncPlanInput {
  projectRootPath: string;
  safeDeleteRootPath: string;
  remoteFiles: PageMarkdownFile[];
  localFiles: LocalMarkdownFileSnapshot[];
}

export interface CreatePullSyncPlanOptions {
  forceOverwriteLocalChanges?: boolean;
}

export function createPullSyncPlan(
  input: CreatePullSyncPlanInput,
  options: CreatePullSyncPlanOptions = {}
): PullSyncPlan {
  const localPageFiles = input.localFiles
    .map(toLocalMarkdownPageFile)
    .filter((file): file is LocalMarkdownPageFile => file !== null)
    .filter((file) => !isInsideSafeDeleteFolder(file.vaultPath, input.safeDeleteRootPath));
  const { localFilesByPageId, duplicateLocalFilesByPageId } = indexLocalFilesByPageId(localPageFiles);
  const remotePageIds = new Set(input.remoteFiles.map((file) => file.pageId));
  const filesToWrite: PageMarkdownFileWriteOperation[] = [];
  const filesToMoveToSafeDelete: SafeDeleteMoveOperation[] = [];
  const skippedLocalChanges: LocalMarkdownPageFile[] = [];
  const overwrittenLocalChanges: LocalMarkdownPageFile[] = [];
  let unchangedFileCount = 0;

  for (const remoteFile of input.remoteFiles) {
    const localFile = localFilesByPageId.get(remoteFile.pageId);
    const duplicateLocalFiles = duplicateLocalFilesByPageId.get(remoteFile.pageId) ?? [];

    skippedLocalChanges.push(...duplicateLocalFiles.map((file) => withSkipReason(file, "duplicate-page-id")));

    if (localFile === undefined) {
      filesToWrite.push({ ...remoteFile, operation: "create" });
      continue;
    }

    if (!canReplaceLocalFile(localFile, remoteFile)) {
      const skipReason = getReplacementSkipReason(localFile);

      if (options.forceOverwriteLocalChanges === true) {
        overwrittenLocalChanges.push(withSkipReason(localFile, skipReason));
        filesToWrite.push({ ...remoteFile, vaultPath: localFile.vaultPath, operation: "update" });
        continue;
      }

      skippedLocalChanges.push(withSkipReason(localFile, skipReason));
      continue;
    }

    if (localFile.content === remoteFile.content) {
      unchangedFileCount += 1;
      continue;
    }

    filesToWrite.push({ ...remoteFile, vaultPath: localFile.vaultPath, operation: "update" });
  }

  for (const localFile of localPageFiles) {
    if (remotePageIds.has(localFile.pageId)) {
      continue;
    }

    if (localFile.hasLocalChanges) {
      skippedLocalChanges.push(withSkipReason(localFile, "disappeared-local-change"));
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
    overwrittenLocalChanges,
    unchangedFileCount,
  };
}

function withSkipReason(file: LocalMarkdownPageFile, skipReason: PullSyncSkipReason): LocalMarkdownPageFile {
  return { ...file, skipReason };
}

function getReplacementSkipReason(localFile: LocalMarkdownPageFile): PullSyncSkipReason {
  return localFile.metadata.contentHash === null ? "legacy-body-mismatch" : "local-change";
}

function indexLocalFilesByPageId(localPageFiles: LocalMarkdownPageFile[]): {
  localFilesByPageId: Map<string, LocalMarkdownPageFile>;
  duplicateLocalFilesByPageId: Map<string, LocalMarkdownPageFile[]>;
} {
  const localFilesByPageId = new Map<string, LocalMarkdownPageFile>();
  const duplicateLocalFilesByPageId = new Map<string, LocalMarkdownPageFile[]>();

  for (const localFile of localPageFiles) {
    if (localFilesByPageId.has(localFile.pageId)) {
      const duplicateLocalFiles = duplicateLocalFilesByPageId.get(localFile.pageId) ?? [];
      duplicateLocalFilesByPageId.set(localFile.pageId, duplicateLocalFiles);
      duplicateLocalFiles.push(localFile);
      continue;
    }

    localFilesByPageId.set(localFile.pageId, localFile);
  }

  return { localFilesByPageId, duplicateLocalFilesByPageId };
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
