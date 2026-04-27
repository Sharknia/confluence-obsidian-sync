import { describe, expect, it, vi } from "vitest";
import { runPullTreeCommand, type PullTreeFetcher } from "./pullTreeCommand";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

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

describe("runPullTreeCommand", () => {
  it("Confluence 연결 설정이 없으면 누락된 필드를 안내한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));

    await runPullTreeCommand({
      settings: createSettings({ apiToken: "" }),
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: apiToken"]);
  });

  it("base URL과 user email 누락은 사람이 읽는 설정 라벨을 유지한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));

    await runPullTreeCommand({
      settings: createSettings({ confluenceBaseUrl: "", userEmail: "" }),
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

    await runPullTreeCommand({
      settings: createSettings({ currentProject: null }),
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Pull Tree 실행 전에 설정 화면에서 루트 콘텐츠 기반 프로젝트를 생성하세요."]);
  });

  it("루트 콘텐츠가 폴더이면 Epic 4 확장 대상임을 안내한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));

    await runPullTreeCommand({
      settings: createSettings({
        currentProject: {
          projectName: "Folder Root",
          spaceId: "SPACE",
          rootContentType: "folder",
          rootContentId: "folder-100",
          rootPageId: "100",
          rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/folders/folder-100",
          localFolderPath: "confluence/Folder Root",
          manifestPath: "confluence/Folder Root/.confluence-sync/manifest.json"
        }
      }),
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["루트 폴더 Pull은 Epic 4 확장에서 구현됩니다."]);
  });

  it("페이지 트리 조회에 성공하면 루트 페이지 ID로 조회하고 페이지와 실패 개수를 안내한다", async () => {
    const notices: string[] = [];
    const fetchedRootPageIds: string[] = [];
    const fetchTree: PullTreeFetcher = (_settings, rootPageId) => {
      fetchedRootPageIds.push(rootPageId);

      return Promise.resolve({
        ok: true,
        root: {
          pageId: "100",
          title: "Root",
          parentId: null,
          versionNumber: 1,
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
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(fetchedRootPageIds).toEqual(["100"]);
    expect(notices).toEqual(["Confluence 페이지 트리를 가져왔습니다: 1개, 실패 1개"]);
  });

  it("치명적 실패가 발생하면 실패 메시지를 안내한다", async () => {
    const notices: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.resolve({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence 페이지 트리를 조회할 수 없습니다."
    });

    await runPullTreeCommand({
      settings: createSettings(),
      fetchTree,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["네트워크 오류로 Confluence 페이지 트리를 조회할 수 없습니다."]);
  });

  it("페이지 트리 조회 중 예기치 못한 오류가 발생하면 Notice와 console.error를 남긴다", async () => {
    const notices: string[] = [];
    const unexpectedError = new Error("unexpected failure");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchTree: PullTreeFetcher = () => Promise.reject(unexpectedError);

    try {
      await runPullTreeCommand({
        settings: createSettings(),
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
