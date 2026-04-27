import { describe, expect, it } from "vitest";
import type { RequestUrlParam } from "obsidian";
import type { ConfluenceRequestTransport } from "../confluence/requestTransport";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import type { ProjectStorageAdapter } from "./projectStorage";
import { createProjectFromRootUrl } from "./createProjectFromRootUrl";

function createSettings(overrides: Partial<ConfluenceSyncSettings> = {}): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net/wiki",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    currentProject: null,
    ...overrides
  };
}

function createTransportMock(
  response: Awaited<ReturnType<ConfluenceRequestTransport>> | Error
): {
  calls: RequestUrlParam[];
  transport: ConfluenceRequestTransport;
} {
  const calls: RequestUrlParam[] = [];

  return {
    calls,
    transport: (request: RequestUrlParam) => {
      calls.push(request);

      if (response instanceof Error) {
        return Promise.reject(response);
      }

      return Promise.resolve(response);
    }
  };
}

function createStorageMock(options: {
  existingPaths?: Set<string>;
  existingFiles?: Map<string, string>;
  failOnWritePath?: string;
} = {}): {
  calls: string[];
  writeCalls: Array<{ path: string; data: string }>;
  storage: ProjectStorageAdapter;
} {
  const calls: string[] = [];
  const writeCalls: Array<{ path: string; data: string }> = [];
  const existingPaths = options.existingPaths ?? new Set<string>();
  const existingFiles = options.existingFiles ?? new Map<string, string>();

  return {
    calls,
    writeCalls,
    storage: {
      exists(path: string): Promise<boolean> {
        calls.push(`exists:${path}`);
        return Promise.resolve(existingPaths.has(path));
      },
      mkdir(path: string): Promise<void> {
        calls.push(`mkdir:${path}`);
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
        calls.push(`write:${path}`);
        writeCalls.push({ path, data });

        if (options.failOnWritePath === path) {
          return Promise.reject(new Error(`write failed: ${path}`));
        }

        existingPaths.add(path);
        existingFiles.set(path, data);
        return Promise.resolve();
      }
    }
  };
}

describe("createProjectFromRootUrl", () => {
  it("returns the created current project and stores the manifest", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 200,
      json: {
        id: "123456789",
        title: "Project Root",
        spaceId: "SPACE",
        version: {
          number: 7
        }
      }
    });
    const storage = createStorageMock();

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root#section",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toEqual({
      ok: true,
      message: "Confluence 프로젝트를 생성했습니다: Project Root",
      currentProject: {
        projectName: "Project Root",
        spaceId: "SPACE",
        rootContentType: "page",
        rootContentId: "123456789",
        rootPageId: "123456789",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
        localFolderPath: "confluence/Project Root",
        manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
      }
    });
    expect(transport.calls).toHaveLength(1);
    expect(storage.writeCalls).toHaveLength(1);
    expect(storage.writeCalls[0]?.path).toBe("confluence/Project Root/.confluence-sync/manifest.json");

    const writtenManifest = JSON.parse(storage.writeCalls[0]?.data ?? "{}") as Record<string, unknown>;

    expect(writtenManifest).toMatchObject({
      manifestVersion: 1,
      projectName: "Project Root",
      confluenceBaseUrl: "https://selta.atlassian.net",
      spaceId: "SPACE",
      rootContentType: "page",
      rootContentId: "123456789",
      rootPageId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localRootFolder: "confluence/Project Root",
      localFolderPath: "confluence/Project Root",
      lastPulledAt: null
    });
  });

  it("creates a project from a root folder URL and stores folder metadata in the manifest", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 200,
      json: {
        id: "987654321",
        title: "Team Folder",
        spaceId: "SPACE"
      }
    });
    const storage = createStorageMock();

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder#children",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toEqual({
      ok: true,
      message: "Confluence 프로젝트를 생성했습니다: Team Folder",
      currentProject: {
        projectName: "Team Folder",
        spaceId: "SPACE",
        rootContentType: "folder",
        rootContentId: "987654321",
        rootPageId: "",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
        localFolderPath: "confluence/Team Folder",
        manifestPath: "confluence/Team Folder/.confluence-sync/manifest.json"
      }
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe("https://selta.atlassian.net/wiki/api/v2/folders/987654321");
    expect(storage.writeCalls).toHaveLength(1);
    expect(storage.writeCalls[0]?.path).toBe("confluence/Team Folder/.confluence-sync/manifest.json");

    const writtenManifest = JSON.parse(storage.writeCalls[0]?.data ?? "{}") as Record<string, unknown>;

    expect(writtenManifest).toMatchObject({
      manifestVersion: 1,
      projectName: "Team Folder",
      confluenceBaseUrl: "https://selta.atlassian.net",
      spaceId: "SPACE",
      rootContentType: "folder",
      rootContentId: "987654321",
      rootPageId: "",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
      localRootFolder: "confluence/Team Folder",
      localFolderPath: "confluence/Team Folder",
      lastPulledAt: null
    });
  });

  it("returns the parser message and does not call transport when the URL is invalid", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 200,
      json: {}
    });
    const storage = createStorageMock();

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "not-a-valid-url",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toEqual({
      ok: false,
      message: "Confluence 루트 콘텐츠 URL을 해석할 수 없습니다."
    });
    expect(transport.calls).toHaveLength(0);
    expect(storage.calls).toHaveLength(0);
  });

  it("returns the metadata message and does not write storage when metadata fetch fails", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 403,
      json: {}
    });
    const storage = createStorageMock();

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toEqual({
      ok: false,
      message: "루트 페이지에 접근할 권한이 없습니다."
    });
    expect(transport.calls).toHaveLength(1);
    expect(storage.writeCalls).toHaveLength(0);
  });

  it("returns the storage message when manifest writing fails", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 200,
      json: {
        id: "123456789",
        title: "Project Root",
        spaceId: "SPACE",
        version: {
          number: 7
        }
      }
    });
    const storage = createStorageMock({
      failOnWritePath: "confluence/Project Root/.confluence-sync/manifest.json"
    });

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toEqual({
      ok: false,
      message: "로컬 프로젝트 폴더 또는 manifest를 생성할 수 없습니다."
    });
    expect(transport.calls).toHaveLength(1);
    expect(storage.writeCalls).toHaveLength(1);
  });

  it("uses a numbered suffix when the title folder already exists without a manifest", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 200,
      json: {
        id: "123456789",
        title: "Project Root",
        spaceId: "SPACE",
        version: {
          number: 7
        }
      }
    });
    const storage = createStorageMock({
      existingPaths: new Set(["confluence/Project Root"])
    });

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toMatchObject({
      ok: true,
      currentProject: {
        localFolderPath: "confluence/Project Root (1)",
        manifestPath: "confluence/Project Root (1)/.confluence-sync/manifest.json"
      }
    });
    expect(storage.writeCalls[0]?.path).toBe("confluence/Project Root (1)/.confluence-sync/manifest.json");
  });

  it("uses a numbered suffix when the title folder contains a different project manifest", async () => {
    const settings = createSettings();
    const transport = createTransportMock({
      status: 200,
      json: {
        id: "123456789",
        title: "Project Root",
        spaceId: "SPACE",
        version: {
          number: 7
        }
      }
    });
    const existingManifest = {
      manifestVersion: 1,
      projectName: "Project Root",
      confluenceBaseUrl: "https://selta.atlassian.net",
      spaceId: "SPACE",
      rootContentType: "page",
      rootContentId: "999999999",
      rootPageId: "999999999",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/999999999/Project+Root",
      localRootFolder: "confluence/Project Root",
      localFolderPath: "confluence/Project Root",
      lastPulledAt: null,
      createdAt: "2026-04-22T12:34:56.000Z",
      updatedAt: "2026-04-22T12:34:56.000Z"
    };
    const storage = createStorageMock({
      existingPaths: new Set([
        "confluence/Project Root",
        "confluence/Project Root/.confluence-sync",
        "confluence/Project Root/.confluence-sync/manifest.json"
      ]),
      existingFiles: new Map([
        ["confluence/Project Root/.confluence-sync/manifest.json", `${JSON.stringify(existingManifest, null, 2)}\n`]
      ])
    });

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toMatchObject({
      ok: true,
      currentProject: {
        localFolderPath: "confluence/Project Root (1)",
        manifestPath: "confluence/Project Root (1)/.confluence-sync/manifest.json"
      }
    });
    expect(storage.writeCalls[0]?.path).toBe("confluence/Project Root (1)/.confluence-sync/manifest.json");
  });

  it("returns the buildProjectPaths error message when the default project folder is invalid", async () => {
    const settings = createSettings({
      defaultProjectFolder: "../outside"
    });
    const transport = createTransportMock({
      status: 200,
      json: {
        id: "123456789",
        title: "Project Root",
        spaceId: "SPACE",
        version: {
          number: 7
        }
      }
    });
    const storage = createStorageMock();

    const result = await createProjectFromRootUrl({
      settings,
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      transport: transport.transport,
      storage: storage.storage,
      now: () => new Date("2026-04-23T12:34:56.000Z")
    });

    expect(result).toEqual({
      ok: false,
      message: "vault 폴더 경로에는 '..'을 사용할 수 없습니다."
    });
    expect(transport.calls).toHaveLength(1);
    expect(storage.writeCalls).toHaveLength(0);
  });
});
