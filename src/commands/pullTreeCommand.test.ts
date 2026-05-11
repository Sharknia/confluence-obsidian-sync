import { describe, expect, it, vi } from "vitest";
import { runPullTreeCommand, type PullTreeFetcher } from "./pullTreeCommand";
import { calculateMarkdownBodyHash } from "../projects/pageMarkdown";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";

interface StorageMock extends ProjectStorageAdapter {
  writtenFiles: Array<{ path: string; data: string }>;
  movedFiles: Array<{ fromPath: string; toPath: string }>;
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
  const movedFiles: Array<{ fromPath: string; toPath: string }> = [];

  return {
    writtenFiles,
    movedFiles,
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    read: () => Promise.resolve(""),
    write: (path, data) => {
      writtenFiles.push({ path, data });
      return Promise.resolve();
    },
    list: () => Promise.resolve({ files: [], folders: [] }),
    rename: (fromPath, toPath) => {
      movedFiles.push({ fromPath, toPath });
      return Promise.resolve();
    },
    ...overrides
  };
}

function getMarkdownPageWrites(storage: StorageMock): Array<{ path: string; data: string }> {
  return storage.writtenFiles.filter(
    (file) => !file.path.includes("/.confluence-sync/") && !file.path.startsWith("logs/")
  );
}

function getPullReportWrites(storage: StorageMock): Array<{ path: string; data: string }> {
  return storage.writtenFiles.filter((file) => file.path.startsWith("logs/"));
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

  it("현재 프로젝트가 없으면 Pull 실행 중 프로젝트를 자동 생성하고 페이지 트리를 조회한다", async () => {
    const notices: string[] = [];
    const settings = createSettings({ currentProject: null });
    const storage = createStorageMock();
    const createdProject: CurrentConfluenceProjectSettings = {
      projectName: "Auto Root",
      spaceId: "SPACE",
      rootContentType: "page",
      rootContentId: "200",
      rootPageId: "200",
      rootUrl: settings.defaultRootContentUrl,
      localFolderPath: "confluence/Auto Root",
      manifestPath: "confluence/Auto Root/.confluence-sync/manifest.json"
    };
    const fetchedRoots: Array<{ rootContentType: "page" | "folder"; rootContentId: string }> = [];
    const fetchTree: PullTreeFetcher = (_settings, rootContentType, rootContentId) => {
      fetchedRoots.push({ rootContentType, rootContentId });

      return Promise.resolve({
        ok: true,
        root: {
          pageId: "200",
          title: "Auto Root",
          parentId: null,
          versionNumber: 1,
          bodyStorageValue: "<p>Hello</p>",
          sourceUrl: settings.defaultRootContentUrl,
          depth: 0,
          childPosition: 0,
          children: []
        },
        pages: [],
        errors: []
      });
    };

    await runPullTreeCommand({
      settings,
      storage,
      fetchTree,
      ensureCurrentProject: () =>
        Promise.resolve({
          ok: true,
          currentProject: createdProject
        }),
      showNotice: (message) => notices.push(message)
    });

    expect(fetchedRoots).toEqual([{ rootContentType: "page", rootContentId: "200" }]);
    expect(notices).toEqual(["Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
  });

  it("프로젝트 자동 생성에 실패하면 latest 로그에 원인을 남기고 Pull을 중단한다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
    const fetchTree: PullTreeFetcher = () => Promise.reject(new Error("fetchTree should not be called"));
    const storage = createStorageMock();

    await runPullTreeCommand({
      settings: createSettings({ currentProject: null }),
      storage,
      fetchTree,
      ensureCurrentProject: () =>
        Promise.resolve({
          ok: false,
          message: "루트 콘텐츠 URL을 해석할 수 없습니다."
        }),
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(getPullReportWrites(storage)).toHaveLength(1);
    expect(getPullReportWrites(storage)[0]?.path).toBe("logs/latest.md");
    expect(getPullReportWrites(storage)[0]?.data).toContain("# 프로젝트 초기화 실패 리포트");
    expect(getPullReportWrites(storage)[0]?.data).toContain("루트 콘텐츠 URL을 해석할 수 없습니다.");
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(notices).toEqual(["프로젝트 초기화 실패: 루트 콘텐츠 URL을 해석할 수 없습니다."]);
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
    expect(getMarkdownPageWrites(storage)).toEqual([]);
    expect(notices).toEqual(["Pull 완료: 추가 0개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
  });

  it("페이지 트리 조회에 성공하면 Markdown 파일을 저장하고 페이지와 조회 실패 개수를 안내한다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
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
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(fetchedRoots).toEqual([{ rootContentType: "page", rootContentId: "100" }]);
    expect(getMarkdownPageWrites(storage).map((file) => file.path)).toEqual(["confluence/Root/Root.md"]);
    expect(getMarkdownPageWrites(storage)[0]?.data).toContain('confluencePageId: "100"');
    expect(getPullReportWrites(storage).map((file) => file.path)).toEqual([
      "logs/latest.md"
    ]);
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(getPullReportWrites(storage)[0]?.data).toContain("- [[confluence/Root/Root.md]] pageId=100");
    expect(getPullReportWrites(storage)[0]?.data).toContain("- 조회 실패: 1개");
    expect(notices).toEqual([
      "Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개, 조회 실패 1개"
    ]);
  });

  it("writes fetch failure and conversion issue details to latest report", async () => {
    const notices: string[] = [];
    const storage = createStorageMock();
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        bodyStorageValue: '<ac:structured-macro ac:name="toc" />',
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({
        ok: true,
        root: { ...rootPage, children: [] },
        pages: [rootPage],
        errors: [
          {
            pageId: "200",
            title: "Private Child",
            reason: "permission-denied",
            message: "Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."
          },
          {
            pageId: "300",
            title: "Busy Child",
            reason: "rate-limited",
            message: "Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"
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

    const report = getPullReportWrites(storage)[0]?.data ?? "";
    expect(report).toContain("## 조회 실패 상세");
    expect(report).toContain(
      '- pageId=200 title="Private Child" reason=permission-denied message="Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."'
    );
    expect(report).toContain(
      '- pageId=300 title="Busy Child" reason=rate-limited message="Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"'
    );
    expect(report).toContain("## 변환 문제 상세");
    expect(report).toContain(
      '- pageId=100 title="Root" severity=warning message="지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: toc"'
    );
    expect(notices).toEqual([
      "Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개, 조회 실패 2개, 변환 경고 1개"
    ]);
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

    expect(notices).toEqual(["Pull 결과를 로컬 파일에 적용할 수 없습니다."]);
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
    const openedReports: string[] = [];
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
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(notices).toEqual([
      "Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개, 변환 경고 1개"
    ]);
  });

  it("기존 파일이 로컬 수정되지 않았으면 같은 경로를 갱신한다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
    const existingBody = "Old body\n";
    const storage = createStorageMock({
      list: (path) =>
        Promise.resolve(
          path === "confluence/Root"
            ? { files: ["confluence/Root/Old Root.md"], folders: [] }
            : { files: [], folders: [] }
        ),
      read: () =>
        Promise.resolve(`---
confluencePageId: "100"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(existingBody)}"
---

${existingBody}`)
    });
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 2,
        bodyStorageValue: "<p>New body</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({ ok: true, root: { ...rootPage, children: [] }, pages: [rootPage], errors: [] });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(getMarkdownPageWrites(storage).map((file) => file.path)).toEqual(["confluence/Root/Old Root.md"]);
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(notices).toEqual(["Pull 완료: 추가 0개, 갱신 1개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
  });

  it("로컬 수정된 기존 파일은 덮어쓰지 않는다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
    const previousPulledBody = "Remote v1\n";
    const storage = createStorageMock({
      list: (path) =>
        Promise.resolve(
          path === "confluence/Root"
            ? { files: ["confluence/Root/Root.md"], folders: [] }
            : { files: [], folders: [] }
        ),
      read: () =>
        Promise.resolve(`---
confluencePageId: "100"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(previousPulledBody)}"
---

Local draft
`)
    });
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 2,
        bodyStorageValue: "<p>Remote body</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({ ok: true, root: { ...rootPage, children: [] }, pages: [rootPage], errors: [] });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(getMarkdownPageWrites(storage)).toEqual([]);
    expect(getPullReportWrites(storage).map((file) => file.path)).toEqual([
      "logs/latest.md"
    ]);
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(getPullReportWrites(storage)[0]?.data).toContain("## 로컬 수정 스킵");
    expect(getPullReportWrites(storage)[0]?.data).toContain("[[confluence/Root/Root.md]]");
    expect(getPullReportWrites(storage)[0]?.data).toContain("local-change");
    expect(notices).toEqual(["Pull 완료: 추가 0개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 1개, 변경 없음 0개"]);
  });

  it("Force Pull Tree를 승인하면 로컬 수정된 기존 파일을 원격 본문으로 덮어쓴다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
    const confirmMessages: string[] = [];
    const previousPulledBody = "Remote v1\n";
    const storage = createStorageMock({
      list: (path) =>
        Promise.resolve(
          path === "confluence/Root"
            ? { files: ["confluence/Root/Root.md"], folders: [] }
            : { files: [], folders: [] }
        ),
      read: () =>
        Promise.resolve(`---
confluencePageId: "100"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(previousPulledBody)}"
---

Local draft
`)
    });
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 2,
        bodyStorageValue: "<p>Remote body</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({ ok: true, root: { ...rootPage, children: [] }, pages: [rootPage], errors: [] });
    };

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      mode: "force",
      confirmForcePull: (message) => {
        confirmMessages.push(message);
        return true;
      },
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(confirmMessages).toEqual([
      "로컬의 변경사항이 모두 취소됩니다. 정말 실행하시겠습니까?\n\n로컬 변경사항: 1건"
    ]);
    expect(getMarkdownPageWrites(storage).map((file) => file.path)).toEqual(["confluence/Root/Root.md"]);
    expect(getMarkdownPageWrites(storage)[0]?.data).toContain("Remote body");
    expect(getPullReportWrites(storage)[0]?.data).toContain("## 강제 덮어쓰기");
    expect(getPullReportWrites(storage)[0]?.data).toContain("[[confluence/Root/Root.md]]");
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(notices).toEqual(["Force Pull 완료: 추가 0개, 갱신 1개, 강제 덮어쓰기 1개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
  });

  it("Force Pull Tree를 취소하면 변경된 로컬 파일 목록 리포트를 쓰고 연다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
    const previousPulledBody = "Remote v1\n";
    const storage = createStorageMock({
      list: (path) =>
        Promise.resolve(
          path === "confluence/Root"
            ? { files: ["confluence/Root/Root.md"], folders: [] }
            : { files: [], folders: [] }
        ),
      read: () =>
        Promise.resolve(`---
confluencePageId: "100"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(previousPulledBody)}"
---

Local draft
`)
    });
    const fetchTree = vi.fn<PullTreeFetcher>(() => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 2,
        bodyStorageValue: "<p>Remote body</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0
      };

      return Promise.resolve({ ok: true, root: { ...rootPage, children: [] }, pages: [rootPage], errors: [] });
    });

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      fetchTree,
      mode: "force",
      confirmForcePull: () => false,
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(getMarkdownPageWrites(storage)).toEqual([]);
    expect(getPullReportWrites(storage).map((file) => file.path)).toEqual(["logs/latest.md"]);
    expect(getPullReportWrites(storage)[0]?.data).toContain("# Force Pull 취소 리포트");
    expect(getPullReportWrites(storage)[0]?.data).toContain("[[confluence/Root/Root.md]]");
    expect(fetchTree).not.toHaveBeenCalled();
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(notices).toEqual(["Force Pull을 취소했습니다. 변경된 로컬 파일 목록을 리포트로 남겼습니다."]);
  });

  it("Force Pull Tree overwrites local changes without creating detached current-page backups", async () => {
    const notices: string[] = [];
    const localBody = "Local edit\n";
    const localContent = `---
confluencePageId: "100"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash("Old remote\n")}"
---

${localBody}`;
    const storage = createStorageMock({
      exists: (path) => Promise.resolve(path === "confluence/Root/Root.md"),
      read: (path) => (path === "confluence/Root/Root.md" ? Promise.resolve(localContent) : Promise.resolve("")),
      list: () =>
        Promise.resolve({
          files: ["confluence/Root/Root.md"],
          folders: []
        })
    });

    await runPullTreeCommand({
      settings: createSettings(),
      storage,
      mode: "force",
      confirmForcePull: () => true,
      fetchTree: () =>
        Promise.resolve({
          ok: true,
          root: {
            pageId: "100",
            title: "Root",
            parentId: null,
            versionNumber: 2,
            bodyStorageValue: "<p>Remote</p>",
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
              versionNumber: 2,
              bodyStorageValue: "<p>Remote</p>",
              sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
              depth: 0,
              childPosition: 0
            }
          ],
          errors: []
        }),
      showNotice: (message) => notices.push(message)
    });

    expect(storage.writtenFiles.some((file) => file.path.includes(".local-backup-"))).toBe(false);
    expect(notices[0]).toContain("Force Pull 완료");
    expect(notices[0]).toContain("강제 덮어쓰기 1개");
  });

  it("Confluence에서 사라진 파일은 안전 삭제 폴더로 이동한다", async () => {
    const notices: string[] = [];
    const openedReports: string[] = [];
    const existingBody = "Old body\n";
    const storage = createStorageMock({
      list: (path) =>
        Promise.resolve(
          path === "confluence/Root"
            ? { files: ["confluence/Root/Removed.md"], folders: [] }
            : { files: [], folders: [] }
        ),
      read: () =>
        Promise.resolve(`---
confluencePageId: "999"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(existingBody)}"
---

${existingBody}`)
    });
    const fetchTree: PullTreeFetcher = () => {
      const rootPage = {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        bodyStorageValue: "<p>Root</p>",
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
      showNotice: (message) => notices.push(message),
      openReport: (path) => {
        openedReports.push(path);
        return Promise.resolve();
      }
    });

    expect(storage.movedFiles[0]?.fromPath).toBe("confluence/Root/Removed.md");
    expect(storage.movedFiles[0]?.toPath).toContain("confluence/Root/.confluence-sync/trash/");
    expect(storage.movedFiles[0]?.toPath).toContain("/Removed.md");
    expect(openedReports).toEqual(["logs/latest.md"]);
    expect(getPullReportWrites(storage)[0]?.data).toContain("[[confluence/Root/Removed.md]]");
    expect(getPullReportWrites(storage)[0]?.data).toContain("[[confluence/Root/.confluence-sync/trash/");
    expect(notices).toEqual(["Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 1개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
  });

  it("로컬 Markdown 목록을 읽을 수 없으면 목록 조회 실패 Notice를 안내한다", async () => {
    const notices: string[] = [];
    const storage = createStorageMock({
      list: vi.fn(() => Promise.reject(new Error("list failed")))
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

    expect(notices).toEqual(["로컬 Markdown 파일 목록을 읽을 수 없습니다."]);
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
