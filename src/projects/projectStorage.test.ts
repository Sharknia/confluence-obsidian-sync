import { describe, expect, it } from "vitest";
import type { ConfluenceProjectManifest, ProjectPaths } from "./projectManifest";
import type { PageMarkdownFile } from "./pageMarkdown";
import type { PullSyncPlan } from "./pullSyncPolicy";
import {
  applyPullSyncPlan,
  listProjectMarkdownFiles,
  writeMarkdownPages,
  writeProjectManifest,
  type ProjectStorageAdapter,
} from "./projectStorage";

function createProjectPaths(): ProjectPaths {
  return {
    projectRootPath: "confluence/confluence-page-123456789",
    manifestFolderPath: "confluence/confluence-page-123456789/.confluence-sync",
    manifestPath: "confluence/confluence-page-123456789/.confluence-sync/manifest.json"
  };
}

function createManifest(): ConfluenceProjectManifest {
  return {
    manifestVersion: 1,
    projectName: "Project Root",
    confluenceBaseUrl: "https://example.atlassian.net",
    spaceId: "SPACE",
    rootContentType: "page",
    rootContentId: "123456789",
    rootPageId: "123456789",
    rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
    localRootFolder: "confluence/confluence-page-123456789",
    localFolderPath: "confluence/confluence-page-123456789",
    lastPulledAt: null,
    createdAt: "2026-04-23T12:34:56.000Z",
    updatedAt: "2026-04-23T12:34:56.000Z"
  };
}

interface StorageMockOptions {
  existingPaths?: Set<string>;
  existingFiles?: Map<string, string>;
  listedFolders?: Map<string, { files: string[]; folders: string[] }>;
  failOnListPath?: string;
  failOnMkdirPath?: string;
  failOnWritePath?: string;
  failOnRenamePath?: string;
  onExists?: (path: string, callCount: number) => boolean;
}

function createStorageMock(options: StorageMockOptions = {}) {
  const calls: string[] = [];
  const existingPaths = options.existingPaths ?? new Set<string>();
  const existingFiles = options.existingFiles ?? new Map<string, string>();
  const existsCallCounts = new Map<string, number>();

  const storage: ProjectStorageAdapter = {
    exists(path: string): Promise<boolean> {
      calls.push(`exists:${path}`);
      const nextCallCount = (existsCallCounts.get(path) ?? 0) + 1;
      existsCallCounts.set(path, nextCallCount);

      if (options.onExists !== undefined) {
        return Promise.resolve(options.onExists(path, nextCallCount));
      }

      return Promise.resolve(existingPaths.has(path));
    },
    mkdir(path: string): Promise<void> {
      calls.push(`mkdir:${path}`);

      if (options.failOnMkdirPath === path) {
        return Promise.reject(new Error(`mkdir failed: ${path}`));
      }

      existingPaths.add(path);
      return Promise.resolve();
    },
    read(path: string): Promise<string> {
      calls.push(`read:${path}`);
      const fileContent = existingFiles.get(path);

      if (fileContent === undefined) {
        return Promise.reject(new Error(`read failed: ${path}`));
      }

      return Promise.resolve(fileContent);
    },
    write(path: string, data: string): Promise<void> {
      calls.push(`write:${path}:${data}`);

      if (options.failOnWritePath === path) {
        return Promise.reject(new Error(`write failed: ${path}`));
      }

      existingPaths.add(path);
      existingFiles.set(path, data);
      return Promise.resolve();
    },
    list(path: string): Promise<{ files: string[]; folders: string[] }> {
      calls.push(`list:${path}`);

      if (options.failOnListPath === path) {
        return Promise.reject(new Error(`list failed: ${path}`));
      }

      return Promise.resolve(options.listedFolders?.get(path) ?? { files: [], folders: [] });
    },
    rename(fromPath: string, toPath: string): Promise<void> {
      calls.push(`rename:${fromPath}:${toPath}`);

      if (options.failOnRenamePath === fromPath) {
        return Promise.reject(new Error(`rename failed: ${fromPath}`));
      }

      const content = existingFiles.get(fromPath);
      existingPaths.delete(fromPath);
      existingPaths.add(toPath);

      if (content !== undefined) {
        existingFiles.delete(fromPath);
        existingFiles.set(toPath, content);
      }

      return Promise.resolve();
    }
  };

  return { calls, storage };
}

describe("writeProjectManifest", () => {
  it("creates folders in order and writes a formatted manifest with a trailing newline", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const { calls, storage } = createStorageMock();

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: true,
      manifestPath: paths.manifestPath
    });
    expect(calls).toEqual([
      `exists:${paths.manifestPath}`,
      `exists:${paths.projectRootPath}`,
      `mkdir:${paths.projectRootPath}`,
      `exists:${paths.manifestFolderPath}`,
      `mkdir:${paths.manifestFolderPath}`,
      `exists:${paths.manifestPath}`,
      `write:${paths.manifestPath}:${JSON.stringify(manifest, null, 2)}\n`
    ]);
  });

  it("skips mkdir when both folders already exist and writes only the manifest", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const { calls, storage } = createStorageMock({
      existingPaths: new Set([paths.projectRootPath, paths.manifestFolderPath])
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: true,
      manifestPath: paths.manifestPath
    });
    expect(calls).toEqual([
      `exists:${paths.manifestPath}`,
      `exists:${paths.projectRootPath}`,
      `exists:${paths.manifestFolderPath}`,
      `exists:${paths.manifestPath}`,
      `write:${paths.manifestPath}:${JSON.stringify(manifest, null, 2)}\n`
    ]);
  });

  it("updates an existing manifest when it belongs to the same project", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const updatedManifest = {
      ...manifest,
      projectName: "Renamed Project Root",
      spaceId: "NEW-SPACE",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/123456789/Renamed+Project+Root"
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set([paths.manifestPath]),
      existingFiles: new Map([[paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`]])
    });

    const result = await writeProjectManifest(storage, paths, updatedManifest);

    expect(result).toEqual({
      ok: true,
      manifestPath: paths.manifestPath
    });
    expect(calls).toEqual([
      `exists:${paths.manifestPath}`,
      `read:${paths.manifestPath}`,
      `write:${paths.manifestPath}:${JSON.stringify(updatedManifest, null, 2)}\n`
    ]);
  });

  it("normalizes an incomplete existing manifest when it has the same project identity", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const existingManifest = {
      confluenceBaseUrl: manifest.confluenceBaseUrl,
      rootPageId: manifest.rootPageId,
      localRootFolder: manifest.localRootFolder
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set([paths.manifestPath]),
      existingFiles: new Map([[paths.manifestPath, `${JSON.stringify(existingManifest, null, 2)}\n`]])
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: true,
      manifestPath: paths.manifestPath
    });
    expect(calls).toEqual([
      `exists:${paths.manifestPath}`,
      `read:${paths.manifestPath}`,
      `write:${paths.manifestPath}:${JSON.stringify(manifest, null, 2)}\n`
    ]);
  });

  it("updates an existing folder manifest when it belongs to the same folder project", async () => {
    const paths = {
      projectRootPath: "confluence/confluence-folder-987654321",
      manifestFolderPath: "confluence/confluence-folder-987654321/.confluence-sync",
      manifestPath: "confluence/confluence-folder-987654321/.confluence-sync/manifest.json"
    };
    const manifest = {
      ...createManifest(),
      projectName: "Team Folder",
      rootContentType: "folder" as const,
      rootContentId: "987654321",
      rootPageId: "",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/folders/987654321",
      localRootFolder: "confluence/confluence-folder-987654321",
      localFolderPath: "confluence/confluence-folder-987654321"
    };
    const updatedManifest = {
      ...manifest,
      projectName: "Renamed Team Folder"
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set([paths.manifestPath]),
      existingFiles: new Map([[paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`]])
    });

    const result = await writeProjectManifest(storage, paths, updatedManifest);

    expect(result).toEqual({
      ok: true,
      manifestPath: paths.manifestPath
    });
    expect(calls).toEqual([
      `exists:${paths.manifestPath}`,
      `read:${paths.manifestPath}`,
      `write:${paths.manifestPath}:${JSON.stringify(updatedManifest, null, 2)}\n`
    ]);
  });

  it("returns manifest-already-exists when root content id matches but root content type differs", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const existingManifest = {
      ...manifest,
      rootContentType: "folder",
      rootContentId: manifest.rootContentId,
      rootPageId: ""
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set([paths.manifestPath]),
      existingFiles: new Map([[paths.manifestPath, `${JSON.stringify(existingManifest, null, 2)}\n`]])
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: false,
      reason: "manifest-already-exists",
      message: "이미 프로젝트 manifest가 존재합니다. 기존 프로젝트를 덮어쓰지 않습니다."
    });
    expect(calls).toEqual([`exists:${paths.manifestPath}`, `read:${paths.manifestPath}`]);
  });

  it("returns manifest-already-exists without creating folders or writing when a different manifest already exists", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const existingManifest = {
      ...manifest,
      rootContentId: "987654321",
      rootPageId: "987654321",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/987654321/Other+Root"
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set([paths.manifestPath]),
      existingFiles: new Map([[paths.manifestPath, `${JSON.stringify(existingManifest, null, 2)}\n`]])
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: false,
      reason: "manifest-already-exists",
      message: "이미 프로젝트 manifest가 존재합니다. 기존 프로젝트를 덮어쓰지 않습니다."
    });
    expect(calls).toEqual([`exists:${paths.manifestPath}`, `read:${paths.manifestPath}`]);
  });

  it("returns manifest-already-exists when the manifest appears after folder creation", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const { calls, storage } = createStorageMock({
      existingFiles: new Map([
        [
          paths.manifestPath,
          `${JSON.stringify(
            {
              ...manifest,
              rootContentId: "987654321",
              rootPageId: "987654321",
              rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/987654321/Other+Root"
            },
            null,
            2
          )}\n`
        ]
      ]),
      onExists: (path, callCount) => {
        if (path !== paths.manifestPath) {
          return false;
        }

        return callCount >= 2;
      }
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: false,
      reason: "manifest-already-exists",
      message: "이미 프로젝트 manifest가 존재합니다. 기존 프로젝트를 덮어쓰지 않습니다."
    });
    expect(calls).toEqual([
      `exists:${paths.manifestPath}`,
      `exists:${paths.projectRootPath}`,
      `mkdir:${paths.projectRootPath}`,
      `exists:${paths.manifestFolderPath}`,
      `mkdir:${paths.manifestFolderPath}`,
      `exists:${paths.manifestPath}`,
      `read:${paths.manifestPath}`
    ]);
  });

  it("returns storage-error when mkdir throws", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const { storage } = createStorageMock({
      failOnMkdirPath: paths.projectRootPath
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: false,
      reason: "storage-error",
      message: "로컬 프로젝트 폴더 또는 manifest를 생성할 수 없습니다."
    });
  });

  it("returns storage-error when write throws", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const { storage } = createStorageMock({
      failOnWritePath: paths.manifestPath
    });

    const result = await writeProjectManifest(storage, paths, manifest);

    expect(result).toEqual({
      ok: false,
      reason: "storage-error",
      message: "로컬 프로젝트 폴더 또는 manifest를 생성할 수 없습니다."
    });
  });
});

describe("writeMarkdownPages", () => {
  function createMarkdownFile(vaultPath: string, content: string): PageMarkdownFile {
    return {
      pageId: vaultPath,
      title: vaultPath,
      vaultPath,
      content,
      warnings: []
    };
  }

  it("creates parent folders in order before writing markdown files", async () => {
    const files = [
      createMarkdownFile("confluence/Root/Root.md", "# Root\n"),
      createMarkdownFile("confluence/Root/Child/Child.md", "# Child\n")
    ];
    const { calls, storage } = createStorageMock();

    const result = await writeMarkdownPages(storage, files);

    expect(result).toEqual({
      ok: true,
      writtenFileCount: files.length
    });
    expect(calls).toEqual([
      "exists:confluence",
      "mkdir:confluence",
      "exists:confluence/Root",
      "mkdir:confluence/Root",
      "write:confluence/Root/Root.md:# Root\n",
      "exists:confluence/Root/Child",
      "mkdir:confluence/Root/Child",
      "write:confluence/Root/Child/Child.md:# Child\n"
    ]);
  });

  it("returns storage-error when a markdown write fails", async () => {
    const files = [createMarkdownFile("confluence/Root/Root.md", "# Root\n")];
    const { calls, storage } = createStorageMock({
      failOnWritePath: files[0].vaultPath
    });

    const result = await writeMarkdownPages(storage, files);

    expect(result).toEqual({
      ok: false,
      reason: "storage-error",
      message: "Markdown 파일을 저장할 수 없습니다."
    });
    expect(calls).toEqual([
      "exists:confluence",
      "mkdir:confluence",
      "exists:confluence/Root",
      "mkdir:confluence/Root",
      "write:confluence/Root/Root.md:# Root\n"
    ]);
  });
});

describe("listProjectMarkdownFiles", () => {
  it("recursively lists markdown files and skips the safe delete folder", async () => {
    const { storage } = createStorageMock({
      existingFiles: new Map([
        ["confluence/Root/Root.md", "root"],
        ["confluence/Root/Folder/Child.md", "child"],
        ["confluence/Root/.confluence-sync/trash/old.md", "old"],
      ]),
      listedFolders: new Map([
        [
          "confluence/Root",
          {
            files: ["confluence/Root/Root.md", "confluence/Root/notes.txt"],
            folders: ["confluence/Root/Folder", "confluence/Root/.confluence-sync"],
          },
        ],
        [
          "confluence/Root/Folder",
          {
            files: ["confluence/Root/Folder/Child.md"],
            folders: [],
          },
        ],
        [
          "confluence/Root/.confluence-sync",
          {
            files: [],
            folders: ["confluence/Root/.confluence-sync/trash"],
          },
        ],
      ]),
    });

    const result = await listProjectMarkdownFiles(
      storage,
      "confluence/Root",
      "confluence/Root/.confluence-sync/trash"
    );

    expect(result).toEqual({
      ok: true,
      files: [
        { vaultPath: "confluence/Root/Root.md", content: "root" },
        { vaultPath: "confluence/Root/Folder/Child.md", content: "child" },
      ],
    });
  });

  it("returns storage-error when a folder cannot be listed", async () => {
    const { storage } = createStorageMock({
      failOnListPath: "confluence/Root",
    });

    await expect(
      listProjectMarkdownFiles(storage, "confluence/Root", "confluence/Root/.confluence-sync/trash")
    ).resolves.toEqual({
      ok: false,
      reason: "storage-error",
      message: "로컬 Markdown 파일 목록을 읽을 수 없습니다.",
    });
  });
});

describe("applyPullSyncPlan", () => {
  it("writes files and moves safe delete files after creating parent folders", async () => {
    const plan: PullSyncPlan = {
      filesToWrite: [
        {
          pageId: "100",
          title: "Root",
          vaultPath: "confluence/Root/Root.md",
          content: "# Root\n",
          warnings: [],
          operation: "update",
        },
      ],
      filesToMoveToSafeDelete: [
        {
          fromPath: "confluence/Root/Old/Removed.md",
          toPath: "confluence/Root/.confluence-sync/trash/2026/Old/Removed.md",
        },
      ],
      skippedLocalChanges: [],
      unchangedFileCount: 2,
    };
    const { calls, storage } = createStorageMock();

    const result = await applyPullSyncPlan(storage, plan);

    expect(result).toEqual({
      ok: true,
      writtenFileCount: 1,
      safeDeletedFileCount: 1,
      skippedLocalChangeCount: 0,
      unchangedFileCount: 2,
    });
    expect(calls).toContain("write:confluence/Root/Root.md:# Root\n");
    expect(calls).toContain("rename:confluence/Root/Old/Removed.md:confluence/Root/.confluence-sync/trash/2026/Old/Removed.md");
  });

  it("returns storage-error when a safe delete move fails", async () => {
    const plan: PullSyncPlan = {
      filesToWrite: [],
      filesToMoveToSafeDelete: [
        {
          fromPath: "confluence/Root/Removed.md",
          toPath: "confluence/Root/.confluence-sync/trash/2026/Removed.md",
        },
      ],
      skippedLocalChanges: [],
      unchangedFileCount: 0,
    };
    const { storage } = createStorageMock({
      failOnRenamePath: "confluence/Root/Removed.md",
    });

    await expect(applyPullSyncPlan(storage, plan)).resolves.toEqual({
      ok: false,
      reason: "storage-error",
      message: "Pull 결과를 로컬 파일에 적용할 수 없습니다.",
    });
  });

  it("adds a numeric suffix when a safe delete destination already exists", async () => {
    const plan: PullSyncPlan = {
      filesToWrite: [],
      filesToMoveToSafeDelete: [
        {
          fromPath: "confluence/Root/Removed.md",
          toPath: "confluence/Root/.confluence-sync/trash/2026/Removed.md",
        },
      ],
      skippedLocalChanges: [],
      unchangedFileCount: 0,
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set(["confluence/Root/.confluence-sync/trash/2026/Removed.md"]),
    });

    const result = await applyPullSyncPlan(storage, plan);

    expect(result).toEqual({
      ok: true,
      writtenFileCount: 0,
      safeDeletedFileCount: 1,
      skippedLocalChangeCount: 0,
      unchangedFileCount: 0,
    });
    expect(calls).toContain(
      "rename:confluence/Root/Removed.md:confluence/Root/.confluence-sync/trash/2026/Removed (1).md"
    );
  });
});
