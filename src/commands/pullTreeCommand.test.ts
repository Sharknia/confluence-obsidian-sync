import { describe, expect, it, vi } from "vitest";
import { runPullTreeCommand, type PullTreeFetcher } from "./pullTreeCommand";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

interface StorageMock extends ProjectStorageAdapter {
  writtenFiles: Array<{ path: string; data: string }>;
}

function createSettings(overrides: Partial<ConfluenceSyncSettings> = {}): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    currentProject: {
      projectName: "Root",
      spaceId: "SPACE",
      rootContentType: "page",
      rootContentId: "100",
      rootPageId: "100",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
      localFolderPath: "confluence/Root",
      manifestPath: "confluence/Root/.confluence-sync/manifest.json"
    },
    ...overrides
  };
}

function createStorageMock(overrides: Partial<ProjectStorageAdapter> = {}): StorageMock {
  const writtenFiles: Array<{ path: string; data: string }> = [];

  return {
    writtenFiles,
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    read: () => Promise.resolve(""),
    write: (path, data) => {
      writtenFiles.push({ path, data });
      return Promise.resolve();
    },
    ...overrides
  };
}

describe("runPullTreeCommand", () => {
  it("Confluence 연결 설정이 없으면 누락된 필드를 안내한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));
    const storage = createStorageMock();

    await runPullTreeCommand({
      settings: createSettings({ apiToken: "" }),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: apiToken"]);
    expect(storage.writtenFiles).toEqual([]);
  });

  it("base URL과 user email 누락은 사람이 읽는 설정 라벨을 유지한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));
    const storage = createStorageMock();

    await runPullTreeCommand({
      settings: createSettings({ confluenceBaseUrl: "", userEmail: "" }),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual([
      "Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: Confluence base URL, Atlassian account email"
    ]);
  });

  it("현재 프로젝트가 없으면 설정 화면에서 프로젝트 생성을 안내한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));
    const storage = createStorageMock();

    await runPullTreeCommand({
      settings: createSettings({ currentProject: null }),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Pull Tree 실행 전에 설정 화면에서 루트 콘텐츠 기반 프로젝트를 생성하세요."]);
  });

  it("루트 콘텐츠가 폴더이면 folder rootContentId로 페이지 트리를 조회한다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock();
    const fetchedRoots: Array<{ rootContentType: "page" | "folder"; rootContentId: string }> = [];
    const fetchTree: PullTreeFetcher = (_settings, rootContentType, rootContentId) => {
      fetchedRoots.push({ rootContentType, rootContentId });

      return Promise.resolve({
        ok: true,
        root: {
          nodeType: "folder",
          contentId: "folder-100",
          title: "Folder Root",
          parentId: null,
          depth: 0,
          childPosition: 0,
          children: []
        },
        pages: [],
        errors: []
      });
    };

    await runPullTreeCommand({
      settings: createSettings({
        currentProject: {
          projectName: "Folder Root",
          spaceId: "SPACE",
          rootContentType: "folder",
          rootContentId: "folder-100",
          rootPageId: "",
          rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/folders/folder-100",
          localFolderPath: "confluence/Folder Root",
          manifestPath: "confluence/Folder Root/.confluence-sync/manifest.json"
        }
      }),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(fetchedRoots).toEqual([{ rootContentType: "folder", rootContentId: "folder-100" }]);
    expect(storage.writtenFiles).toEqual([]);
    expect(notices).toEqual(["Confluence 페이지를 Markdown으로 저장했습니다: 0개"]);
  });

  it("페이지 트리 조회에 성공하면 Markdown 파일을 저장하고 페이지와 조회 실패 개수를 안내한다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock();
    const fetchedRoots: Array<{ rootContentType: "page" | "folder"; rootContentId: string }> = [];
    const fetchTree: PullTreeFetcher = (_settings, rootContentType, rootContentId) => {
      fetchedRoots.push({ rootContentType, rootContentId });

      return Promise.resolve({
        ok: true,
        root: {
          pageId: "100",
          title: "Root",
          parentId: null,
          versionNumber: 1,
          bodyStorageValue: "<p>Hello</p>",
          sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
          depth: 0,
          childPosition: 0,
          children: []
        },
        pages: [
          {
            pageId: "100",
            title: "Root",
            parentId: null,
            versionNumber: 1,
            bodyStorageValue: "<p>Hello</p>",
            sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
            depth: 0,
            childPosition: 0
          }
        ],
        errors: [
          {
            pageId: "200",
            title: "Child",
            reason: "permission-denied",
            message: "Confluence 페이지 트리에 접근할 권한이 없습니다."
          }
        ]
      });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(fetchedRoots).toEqual([{ rootContentType: "page", rootContentId: "100" }]);
    expect(storage.writtenFiles.map((file) => file.path)).toEqual(["confluence/Root/Root.md"]);
    expect(storage.writtenFiles[0]?.data).toContain('confluencePageId: "100"');
    expect(notices).toEqual(["Confluence 페이지를 Markdown으로 저장했습니다: 1개, 조회 실패 1개"]);
  });

  it("Markdown 저장에 실패하면 저장 실패 Notice를 안내한다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock({
      write: vi.fn(() => Promise.reject(new Error("disk full")))
    });
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        bodyStorageValue: "<p>Hello</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({
        ok: true,
        root: { ...rootPage, children: [] },
        pages: [rootPage],
        errors: []
      });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Markdown 파일을 저장할 수 없습니다."]);
  });

  it("Markdown 경로 확인에 실패하면 저장 실패 Notice를 안내한다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock({
      exists: vi.fn(() => Promise.reject(new Error("adapter failure")))
    });
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        bodyStorageValue: "<p>Hello</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({
        ok: true,
        root: { ...rootPage, children: [] },
        pages: [rootPage],
        errors: []
      });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Markdown 파일을 저장할 수 없습니다."]);
  });

  it("Markdown 변환 경고가 있으면 저장 성공 Notice에 경고 개수를 덧붙인다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock();
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        bodyStorageValue: '<ac:structured-macro ac:name="status" />',
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({
        ok: true,
        root: { ...rootPage, children: [] },
        pages: [rootPage],
        errors: []
      });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Confluence 페이지를 Markdown으로 저장했습니다: 1개, 변환 경고 1개"]);
  });

  it("치명적 실패가 발생하면 실패 메시지를 안내한다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock();
    const fetchTree: PullTreeFetcher = () => Promise.resolve({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence 페이지 트리를 조회할 수 없습니다."
    });

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["네트워크 오류로 Confluence 페이지 트리를 조회할 수 없습니다."]);
    expect(storage.writtenFiles).toEqual([]);
  });

  it("페이지 트리 조회 중 예기치 못한 오류가 발생하면 Notice와 console.error를 남긴다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock();
    const unexpectedError = new Error("unexpected failure");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchTree: PullTreeFetcher = () => Promise.reject(unexpectedError);

    try {
      await runPullTreeCommand({
        settings: createSettings(),
        storage,
        fetchTree,
        showNotice: (message) => notices.push(message)
      });

      expect(notices).toEqual(["unexpected failure"]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Pull Tree 실행 중 예기치 못한 오류가 발생했습니다.",
        unexpectedError
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
