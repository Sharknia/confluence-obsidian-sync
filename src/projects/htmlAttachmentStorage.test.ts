import { describe, expect, it } from "vitest";
import { writeHtmlAttachmentFiles, type HtmlAttachmentFileToWrite } from "./htmlAttachmentStorage";
import type { ProjectStorageAdapter } from "./projectStorage";

interface StorageMock extends ProjectStorageAdapter {
  checkedFolders: string[];
  createdFolders: string[];
  writtenFiles: Array<{ path: string; data: string }>;
}

function createStorageMock(initialExistingFolders: string[] = []): StorageMock {
  const checkedFolders: string[] = [];
  const createdFolders: string[] = [];
  const writtenFiles: Array<{ path: string; data: string }> = [];
  const existingFolders = new Set<string>(initialExistingFolders);

  return {
    checkedFolders,
    createdFolders,
    writtenFiles,
    exists: (path) => {
      checkedFolders.push(path);
      return Promise.resolve(existingFolders.has(path));
    },
    mkdir: (path) => {
      existingFolders.add(path);
      createdFolders.push(path);
      return Promise.resolve();
    },
    read: () => Promise.resolve(""),
    write: (path, data) => {
      writtenFiles.push({ path, data });
      return Promise.resolve();
    },
    list: () => Promise.resolve({ files: [], folders: [] }),
    rename: () => Promise.resolve(),
  };
}

describe("writeHtmlAttachmentFiles", () => {
  it("creates parent folders and writes HTML attachment files", async () => {
    const storage = createStorageMock();
    const files: HtmlAttachmentFileToWrite[] = [
      {
        attachmentFileId: "att-1::0",
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-1",
        attachmentTitle: "prototype.html",
        vaultPath: "confluence/Root/Root.assets/prototype.html",
        downloadLink: "/wiki/download/attachments/100/prototype.html",
        html: "<html><body>Prototype</body></html>",
      },
    ];

    const result = await writeHtmlAttachmentFiles(storage, files);

    expect(result).toEqual({ ok: true, writtenFileCount: 1 });
    expect(storage.createdFolders).toEqual(["confluence", "confluence/Root", "confluence/Root/Root.assets"]);
    expect(storage.writtenFiles).toEqual([
      {
        path: "confluence/Root/Root.assets/prototype.html",
        data: "<html><body>Prototype</body></html>",
      },
    ]);
  });

  it("returns a storage error result when writing fails", async () => {
    const files: HtmlAttachmentFileToWrite[] = [
      {
        attachmentFileId: "att-1::0",
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-1",
        attachmentTitle: "prototype.html",
        vaultPath: "confluence/Root/Root.assets/prototype.html",
        downloadLink: "/wiki/download/attachments/100/prototype.html",
        html: "<html></html>",
      },
    ];
    const storage: ProjectStorageAdapter = {
      exists: () => Promise.resolve(false),
      mkdir: () => Promise.resolve(),
      read: () => Promise.resolve(""),
      write: () => Promise.reject(new Error("disk full")),
      list: () => Promise.resolve({ files: [], folders: [] }),
      rename: () => Promise.resolve(),
    };

    await expect(writeHtmlAttachmentFiles(storage, files)).resolves.toEqual({
      ok: false,
      reason: "storage-error",
      message: "HTML 첨부 파일을 저장할 수 없습니다.",
    });
  });

  it("returns a storage error result for invalid vault paths", async () => {
    const invalidVaultPaths = ["", "/a/b.html", "a//b.html", "a/./b.html", "a/../b.html"];

    for (const vaultPath of invalidVaultPaths) {
      const storage = createStorageMock();
      const files: HtmlAttachmentFileToWrite[] = [
        {
          attachmentFileId: "att-1::0",
          pageId: "100",
          pageTitle: "Root",
          attachmentId: "att-1",
          attachmentTitle: "prototype.html",
          vaultPath,
          downloadLink: "/wiki/download/attachments/100/prototype.html",
          html: "<html></html>",
        },
      ];

      await expect(writeHtmlAttachmentFiles(storage, files)).resolves.toEqual({
        ok: false,
        reason: "storage-error",
        message: "HTML 첨부 파일을 저장할 수 없습니다.",
      });
      expect(storage.checkedFolders).toEqual([]);
      expect(storage.createdFolders).toEqual([]);
      expect(storage.writtenFiles).toEqual([]);
    }
  });

  it("checks and creates each parent folder only once in the same call", async () => {
    const storage = createStorageMock();
    const files: HtmlAttachmentFileToWrite[] = [
      {
        attachmentFileId: "att-1::0",
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-1",
        attachmentTitle: "prototype.html",
        vaultPath: "confluence/Root/Root.assets/prototype.html",
        downloadLink: "/wiki/download/attachments/100/prototype.html",
        html: "<html>Prototype</html>",
      },
      {
        attachmentFileId: "att-2::0",
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-2",
        attachmentTitle: "summary.html",
        vaultPath: "confluence/Root/Root.assets/summary.html",
        downloadLink: "/wiki/download/attachments/100/summary.html",
        html: "<html>Summary</html>",
      },
    ];

    await expect(writeHtmlAttachmentFiles(storage, files)).resolves.toEqual({ ok: true, writtenFileCount: 2 });
    expect(storage.checkedFolders).toEqual(["confluence", "confluence/Root", "confluence/Root/Root.assets"]);
    expect(storage.createdFolders).toEqual(["confluence", "confluence/Root", "confluence/Root/Root.assets"]);
    expect(storage.writtenFiles).toEqual([
      {
        path: "confluence/Root/Root.assets/prototype.html",
        data: "<html>Prototype</html>",
      },
      {
        path: "confluence/Root/Root.assets/summary.html",
        data: "<html>Summary</html>",
      },
    ]);
  });

  it("does not create parent folders that already exist", async () => {
    const storage = createStorageMock(["confluence", "confluence/Root"]);
    const files: HtmlAttachmentFileToWrite[] = [
      {
        attachmentFileId: "att-1::0",
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-1",
        attachmentTitle: "prototype.html",
        vaultPath: "confluence/Root/Root.assets/prototype.html",
        downloadLink: "/wiki/download/attachments/100/prototype.html",
        html: "<html></html>",
      },
    ];

    await expect(writeHtmlAttachmentFiles(storage, files)).resolves.toEqual({ ok: true, writtenFileCount: 1 });
    expect(storage.checkedFolders).toEqual(["confluence", "confluence/Root", "confluence/Root/Root.assets"]);
    expect(storage.createdFolders).toEqual(["confluence/Root/Root.assets"]);
  });
});
