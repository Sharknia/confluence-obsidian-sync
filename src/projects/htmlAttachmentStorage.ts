import type { ProjectStorageAdapter } from "./projectStorage";

export interface HtmlAttachmentFileToWrite {
  attachmentFileId: string;
  pageId: string;
  pageTitle: string;
  attachmentId: string;
  attachmentTitle: string;
  vaultPath: string;
  downloadLink: string;
  html: string;
}

export interface WriteHtmlAttachmentFilesSuccess {
  ok: true;
  writtenFileCount: number;
}

export interface WriteHtmlAttachmentFilesFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type WriteHtmlAttachmentFilesResult = WriteHtmlAttachmentFilesSuccess | WriteHtmlAttachmentFilesFailure;

function buildParentFolderPaths(vaultPath: string): string[] {
  const pathSegments = vaultPath.split("/");
  const parentPathSegments = pathSegments.slice(0, -1);
  const parentFolderPaths: string[] = [];

  for (let index = 0; index < parentPathSegments.length; index += 1) {
    parentFolderPaths.push(parentPathSegments.slice(0, index + 1).join("/"));
  }

  return parentFolderPaths;
}

function isValidVaultPath(vaultPath: string): boolean {
  if (vaultPath.length === 0 || vaultPath.startsWith("/")) {
    return false;
  }

  const pathSegments = vaultPath.split("/");

  return pathSegments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function ensureFolderExists(storage: ProjectStorageAdapter, path: string): Promise<void> {
  if (!(await storage.exists(path))) {
    await storage.mkdir(path);
  }
}

function buildStorageErrorFailure(): WriteHtmlAttachmentFilesFailure {
  return {
    ok: false,
    reason: "storage-error",
    message: "HTML 첨부 파일을 저장할 수 없습니다."
  };
}

export async function writeHtmlAttachmentFiles(
  storage: ProjectStorageAdapter,
  files: HtmlAttachmentFileToWrite[]
): Promise<WriteHtmlAttachmentFilesResult> {
  const ensuredFolderPaths = new Set<string>();

  try {
    if (files.some((file) => !isValidVaultPath(file.vaultPath))) {
      return buildStorageErrorFailure();
    }

    for (const file of files) {
      for (const parentFolderPath of buildParentFolderPaths(file.vaultPath)) {
        if (ensuredFolderPaths.has(parentFolderPath)) {
          continue;
        }

        // 상위 폴더는 한 호출 안에서 한 번만 확인해 중복 생성을 피한다.
        await ensureFolderExists(storage, parentFolderPath);
        ensuredFolderPaths.add(parentFolderPath);
      }

      await storage.write(file.vaultPath, file.html);
    }

    return {
      ok: true,
      writtenFileCount: files.length
    };
  } catch {
    return buildStorageErrorFailure();
  }
}
