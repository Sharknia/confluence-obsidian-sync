import { describe, expect, it, vi } from "vitest";
import { calculateMarkdownBodyHash } from "../projects/pageMarkdown";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import { runPullCurrentPageCommand, type PullCurrentPageFetcher } from "./pullCurrentPageCommand";

interface StorageMock extends ProjectStorageAdapter {
  files: Map<string, string>;
  writes: Array<{ path: string; data: string }>;
}

function createSettings(overrides: Partial<ConfluenceSyncSettings> = {}): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    currentProject: null,
    ...overrides
  };
}

function createStorage(initialFiles: Record<string, string>): StorageMock {
  const files = new Map(Object.entries(initialFiles));
  const writes: Array<{ path: string; data: string }> = [];

  return {
    files,
    writes,
    exists: (path) => Promise.resolve(files.has(path)),
    mkdir: () => Promise.resolve(),
    read: (path) => {
      const content = files.get(path);
      return content === undefined ? Promise.reject(new Error("missing file")) : Promise.resolve(content);
    },
    write: (path, data) => {
      writes.push({ path, data });
      files.set(path, data);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ files: [], folders: [] }),
    rename: () => Promise.resolve()
  };
}

function createLocalMarkdown(bodyMarkdown = "Hello\n"): string {
  return `---
confluencePageId: "100"
confluenceTitle: "Root"
confluenceVersion: 3
confluenceSourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root"
confluenceParentId: null
confluenceContentHash: "${calculateMarkdownBodyHash(bodyMarkdown)}"
---

${bodyMarkdown}`;
}

describe("runPullCurrentPageCommand", () => {
  it("requires Confluence connection settings", async () => {
    const notices: string[] = [];
    const storage = createStorage({ "confluence/Root/Root.md": createLocalMarkdown() });

    await runPullCurrentPageCommand({
      settings: createSettings({ apiToken: "" }),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Pull Current Page 실행 전에 Confluence 연결 설정이 필요합니다: apiToken"]);
    expect(storage.writes).toEqual([]);
  });

  it("requires an active markdown file", async () => {
    const notices: string[] = [];
    const storage = createStorage({ "confluence/Root/Root.md": createLocalMarkdown() });

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => null,
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["현재 열린 Markdown 파일이 없습니다."]);
    expect(storage.writes).toEqual([]);
  });

  it("blocks pull when metadata is missing", async () => {
    const notices: string[] = [];

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage({ "notes/Note.md": "---\ntitle: Note\n---\n\nBody\n" }),
      getActiveMarkdownFile: () => ({ path: "notes/Note.md" }),
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Confluence metadata가 있는 Markdown 파일만 Pull할 수 있습니다."]);
  });

  it("blocks pull when version or content hash is missing", async () => {
    const notices: string[] = [];

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage({ "confluence/Root/Root.md": '---\nconfluencePageId: "100"\n---\n\nBody\n' }),
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual([
      "confluenceVersion과 confluenceContentHash가 있어야 Pull Current Page를 실행할 수 있습니다."
    ]);
  });

  it("overwrites current file without backup when local body is unchanged", async () => {
    const notices: string[] = [];
    const storage = createStorage({ "confluence/Root/Root.md": createLocalMarkdown("Hello\n") });
    const fetchPage: PullCurrentPageFetcher = () =>
      Promise.resolve({
        ok: true,
        page: {
          pageId: "100",
          title: "Root",
          parentId: null,
          versionNumber: 4,
          bodyStorageValue: "<p>Remote</p>"
        }
      });

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage,
      showNotice: (message) => notices.push(message)
    });

    expect(storage.writes.map((write) => write.path)).toEqual(["confluence/Root/Root.md"]);
    expect(storage.files.get("confluence/Root/Root.md")).toContain("confluenceVersion: 4");
    expect(storage.files.get("confluence/Root/Root.md")).toContain("Remote\n");
    expect(notices).toEqual(["Pull Current Page 완료: Confluence version 4, 백업 없음"]);
  });

  it("creates detached backup before overwrite when local body changed", async () => {
    const notices: string[] = [];
    const storage = createStorage({
      "confluence/Root/Root.md": `---
confluencePageId: "100"
confluenceTitle: "Root"
confluenceVersion: 3
confluenceSourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root"
confluenceParentId: null
confluenceContentHash: "${calculateMarkdownBodyHash("Original remote\n")}"
---

Local draft
`
    });

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () =>
        Promise.resolve({
          ok: true,
          page: {
            pageId: "100",
            title: "Root",
            parentId: null,
            versionNumber: 4,
            bodyStorageValue: "<p>Remote</p>"
          }
        }),
      now: () => new Date("2026-04-29T10:11:12.000Z"),
      showNotice: (message) => notices.push(message)
    });

    expect(storage.writes.map((write) => write.path)).toEqual([
      "confluence/Root/Root.local-backup-2026-04-29T10-11-12-000Z.md",
      "confluence/Root/Root.md"
    ]);
    expect(storage.files.get("confluence/Root/Root.local-backup-2026-04-29T10-11-12-000Z.md")).toContain(
      "Confluence 연결이 해제된 백업본"
    );
    expect(storage.files.get("confluence/Root/Root.local-backup-2026-04-29T10-11-12-000Z.md")).not.toContain(
      "confluencePageId"
    );
    expect(notices).toEqual([
      "Pull Current Page 완료: Confluence version 4, 백업 생성 confluence/Root/Root.local-backup-2026-04-29T10-11-12-000Z.md"
    ]);
  });

  it("shows remote API failure message", async () => {
    const notices: string[] = [];

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage({ "confluence/Root/Root.md": createLocalMarkdown() }),
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () =>
        Promise.resolve({ ok: false, reason: "not-found", message: "Confluence 페이지를 찾을 수 없습니다." }),
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Confluence 페이지를 찾을 수 없습니다."]);
  });

  it("shows storage failure when backup write fails", async () => {
    const notices: string[] = [];
    const storage = createStorage({
      "confluence/Root/Root.md": `---
confluencePageId: "100"
confluenceVersion: 3
confluenceContentHash: "${calculateMarkdownBodyHash("Original remote\n")}"
---

Local draft
`
    });
    const write = vi.fn(() => Promise.reject(new Error("disk full")));
    storage.write = write;

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () =>
        Promise.resolve({
          ok: true,
          page: {
            pageId: "100",
            title: "Root",
            parentId: null,
            versionNumber: 4,
            bodyStorageValue: "<p>Remote</p>"
          }
        }),
      now: () => new Date("2026-04-29T10:11:12.000Z"),
      showNotice: (message) => notices.push(message)
    });

    expect(write).toHaveBeenCalledOnce();
    expect(notices).toEqual(["Pull Current Page 결과를 로컬 파일에 적용할 수 없습니다."]);
  });

  it("shows storage failure when current file write fails", async () => {
    const notices: string[] = [];
    const storage = createStorage({ "confluence/Root/Root.md": createLocalMarkdown() });
    storage.write = vi.fn(() => Promise.reject(new Error("disk full")));

    await runPullCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () =>
        Promise.resolve({
          ok: true,
          page: {
            pageId: "100",
            title: "Root",
            parentId: null,
            versionNumber: 4,
            bodyStorageValue: "<p>Remote</p>"
          }
        }),
      showNotice: (message) => notices.push(message)
    });

    expect(notices).toEqual(["Pull Current Page 결과를 로컬 파일에 적용할 수 없습니다."]);
  });
});
