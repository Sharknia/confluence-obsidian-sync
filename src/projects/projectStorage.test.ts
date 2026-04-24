import { describe, expect, it } from "vitest";
import type { ConfluenceProjectManifest, ProjectPaths } from "./projectManifest";
import { writeProjectManifest, type ProjectStorageAdapter } from "./projectStorage";

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
  failOnMkdirPath?: string;
  failOnWritePath?: string;
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

  it("returns manifest-already-exists without creating folders or writing when a different manifest already exists", async () => {
    const paths = createProjectPaths();
    const manifest = createManifest();
    const existingManifest = {
      ...manifest,
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
