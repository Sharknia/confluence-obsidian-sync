import { describe, expect, it, vi } from "vitest";
import { runPushCurrentPageCommand, type PushPageFetcher, type PushPageUpdater } from "./pushCurrentPageCommand";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

interface StorageMock extends ProjectStorageAdapter {
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
    ...overrides,
  };
}

function createStorage(content: string): StorageMock {
  const writes: Array<{ path: string; data: string }> = [];

  return {
    writes,
    exists: () => Promise.resolve(true),
    mkdir: () => Promise.resolve(),
    read: () => Promise.resolve(content),
    write: (path, data) => {
      writes.push({ path, data });
      return Promise.resolve();
    },
    list: () => Promise.resolve({ files: [], folders: [] }),
    rename: () => Promise.resolve(),
  };
}

function createMarkdown(versionNumber = 3): string {
  return `---
confluencePageId: "100"
confluenceVersion: ${versionNumber}
confluenceContentHash: "sha256:old"
---

# Title

Hello
`;
}

describe("runPushCurrentPageCommand", () => {
  it("requires Confluence connection settings", async () => {
    const notices: string[] = [];
    const storage = createStorage(createMarkdown());

    await runPushCurrentPageCommand({
      settings: createSettings({ apiToken: "" }),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual(["Push 실행 전에 Confluence 연결 설정이 필요합니다: apiToken"]);
    expect(storage.writes).toEqual([]);
  });

  it("requires an active markdown file", async () => {
    const notices: string[] = [];

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage(createMarkdown()),
      getActiveMarkdownFile: () => null,
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual(["현재 열린 Markdown 파일이 없습니다."]);
  });

  it("blocks push when frontmatter has no confluence page id", async () => {
    const notices: string[] = [];

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage("---\ntitle: Note\n---\n\nHello\n"),
      getActiveMarkdownFile: () => ({ path: "notes/Note.md" }),
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual(["Confluence pageId가 있는 Markdown 파일만 Push할 수 있습니다."]);
  });

  it("blocks push when local version is missing", async () => {
    const notices: string[] = [];

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage('---\nconfluencePageId: "100"\n---\n\nHello\n'),
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual(["confluenceVersion이 없어 Push할 수 없습니다. 먼저 Pull Tree를 실행하세요."]);
  });

  it("blocks push when remote version differs from local frontmatter", async () => {
    const notices: string[] = [];
    const storage = createStorage(createMarkdown(3));
    const fetchPage: PushPageFetcher = () =>
      Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 4 } });

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage,
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual(["Push 차단: 원격 version 4, 로컬 version 3. Pull Tree 후 다시 시도하세요."]);
    expect(storage.writes).toEqual([]);
  });

  it("blocks push when markdown conversion rejects unsupported content", async () => {
    const notices: string[] = [];
    const storage = createStorage(`---
confluencePageId: "100"
confluenceVersion: 3
---

[[Target Page]]
`);
    const updatePage = vi.fn<PushPageUpdater>();

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () => Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 3 } }),
      updatePage,
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual([
      "Obsidian wiki link는 MVP Push에서 지원하지 않습니다. 일반 Markdown 링크로 바꾼 뒤 다시 시도하세요.",
    ]);
    expect(updatePage).not.toHaveBeenCalled();
  });

  it("updates Confluence and local frontmatter on success", async () => {
    const notices: string[] = [];
    const storage = createStorage(createMarkdown(3));
    const updatedBodies: string[] = [];
    const fetchPage: PushPageFetcher = () =>
      Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 3 } });
    const updatePage: PushPageUpdater = (_settings, input) => {
      updatedBodies.push(input.bodyStorageValue);
      return Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 4 } });
    };

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage,
      updatePage,
      showNotice: (message) => notices.push(message),
    });

    expect(updatedBodies).toEqual(["<h1>Title</h1><p>Hello</p>"]);
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]?.path).toBe("confluence/Root/Root.md");
    expect(storage.writes[0]?.data).toContain("confluenceVersion: 4");
    expect(storage.writes[0]?.data).toContain('confluenceContentHash: "sha256:');
    expect(notices).toEqual(["Push 완료: Confluence version 4"]);
  });

  it("shows the remote API failure message", async () => {
    const notices: string[] = [];

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage: createStorage(createMarkdown(3)),
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () => Promise.resolve({ ok: false, reason: "not-found", message: "Confluence 페이지를 찾을 수 없습니다." }),
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual(["Confluence 페이지를 찾을 수 없습니다."]);
  });

  it("shows storage failure when local file cannot be updated after remote success", async () => {
    const notices: string[] = [];
    const storage = createStorage(createMarkdown(3));
    storage.write = vi.fn(() => Promise.reject(new Error("disk full")));

    await runPushCurrentPageCommand({
      settings: createSettings(),
      storage,
      getActiveMarkdownFile: () => ({ path: "confluence/Root/Root.md" }),
      fetchPage: () => Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 3 } }),
      updatePage: () => Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 4 } }),
      showNotice: (message) => notices.push(message),
    });

    expect(notices).toEqual([
      "Confluence에는 업로드됐지만 로컬 frontmatter를 갱신하지 못했습니다. Pull Tree로 version을 다시 맞추세요.",
    ]);
  });
});
