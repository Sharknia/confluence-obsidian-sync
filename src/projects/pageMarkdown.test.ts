import { describe, expect, it } from "vitest";
import type {
  ConfluenceFolderContentTreeNode,
  ConfluencePageTreeNode,
  ConfluencePageTreePage,
} from "../confluence/pageTree";
import {
  buildPageMarkdownFiles,
  calculateMarkdownBodyHash,
  createCurrentPageBackupPath,
  createDetachedPageBackupMarkdown,
  createPageMarkdownContent,
  createSafeMarkdownFileName,
  parsePageMarkdownMetadata,
  updatePageMarkdownFrontmatterAfterPush,
} from "./pageMarkdown";

function createPage(overrides: Partial<ConfluencePageTreePage>): ConfluencePageTreePage {
  return {
    pageId: "100",
    title: "Root",
    parentId: null,
    versionNumber: 1,
    sourceUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/100/Root",
    depth: 0,
    childPosition: 0,
    bodyStorageValue: "<p>Hello</p>",
    ...overrides,
  };
}

describe("createSafeMarkdownFileName", () => {
  it("removes characters that cannot be used safely in vault file names", () => {
    expect(createSafeMarkdownFileName("Team: API / Sync? <Root>*", "123")).toBe("Team API Sync Root.md");
  });

  it("removes control characters, trims trailing dot and space, and avoids reserved file names", () => {
    expect(createSafeMarkdownFileName("CON\u0000. ", "123")).toBe("confluence-page-123.md");
  });

  it("limits very long file names before adding the extension", () => {
    expect(createSafeMarkdownFileName("a".repeat(200), "123")).toBe(`${"a".repeat(120)}.md`);
  });

  it("falls back to page id when title is unusable", () => {
    expect(createSafeMarkdownFileName("///", "123")).toBe("confluence-page-123.md");
  });

  it("falls back for dot-only and Windows reserved device names", () => {
    expect(createSafeMarkdownFileName(".", "123")).toBe("confluence-page-123.md");
    expect(createSafeMarkdownFileName("LPT9", "456")).toBe("confluence-page-456.md");
  });

  it("sanitizes unsafe page IDs before using them in fallback names", () => {
    expect(createSafeMarkdownFileName("///", "../bad:id")).toBe("confluence-page-bad-id.md");
    expect(createSafeMarkdownFileName("///", "???")).toBe("confluence-page-unknown.md");
  });
});

describe("buildPageMarkdownFiles", () => {
  it("creates frontmatter and markdown content for each page", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files).toEqual([
      {
        pageId: "100",
        title: "Root",
        vaultPath: "confluence/Root/Root.md",
        warnings: [],
        content: `---
confluencePageId: "100"
confluenceTitle: "Root"
confluenceVersion: 1
confluenceSourceUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/100/Root"
confluenceParentId: null
confluenceContentHash: "${calculateMarkdownBodyHash("Hello\n")}"
---

Hello
`,
      },
    ]);
  });

  it("stores a stable content hash for the generated markdown body", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root", bodyStorageValue: "<p>Hello</p>" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files[0]?.content).toContain(`confluenceContentHash: "${calculateMarkdownBodyHash("Hello\n")}"`);
  });

  it("parses flat Confluence frontmatter metadata and markdown body", () => {
    const content = `---
confluencePageId: "100"
confluenceVersion: 3
confluenceContentHash: "sha256:abc123"
---

Hello
`;

    expect(parsePageMarkdownMetadata(content)).toEqual({
      pageId: "100",
      versionNumber: 3,
      contentHash: "sha256:abc123",
      bodyMarkdown: "Hello\n",
    });
  });

  it("parses legacy pageId frontmatter without content hash", () => {
    const content = `---
pageId: "200"
---

Legacy body
`;

    expect(parsePageMarkdownMetadata(content)).toEqual({
      pageId: "200",
      versionNumber: null,
      contentHash: null,
      bodyMarkdown: "Legacy body\n",
    });
  });

  it("parses nested legacy Confluence frontmatter without content hash", () => {
    const content = `---
confluence:
  pageId: "300"
---

Nested legacy body
`;

    expect(parsePageMarkdownMetadata(content)).toEqual({
      pageId: "300",
      versionNumber: null,
      contentHash: null,
      bodyMarkdown: "Nested legacy body\n",
    });
  });

  it("returns null when frontmatter does not contain a Confluence page id", () => {
    expect(parsePageMarkdownMetadata("---\ntitle: Notes\n---\n\nBody\n")).toBeNull();
  });

  it("adds numeric suffixes when the same title collides", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const childA = createPage({ pageId: "200", title: "Same", parentId: "100", depth: 1 });
    const childB = createPage({ pageId: "300", title: "Same", parentId: "100", depth: 1, childPosition: 1 });
    const root: ConfluencePageTreeNode = {
      ...rootPage,
      children: [
        { ...childA, children: [] },
        { ...childB, children: [] },
      ],
    };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, childA, childB],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Same.md"),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/Root/Same.md",
      "confluence/Root/Root/Same (1).md",
    ]);
  });

  it("treats case-only filename differences as collisions", async () => {
    const childA = createPage({ pageId: "100", title: "Root", parentId: "folder-100", depth: 1 });
    const childB = createPage({ pageId: "200", title: "root", parentId: "folder-100", depth: 1, childPosition: 1 });
    const root: ConfluenceFolderContentTreeNode = {
      nodeType: "folder",
      contentId: "folder-100",
      title: "Folder Root",
      parentId: null,
      depth: 0,
      childPosition: 0,
      children: [
        { ...childA, children: [] },
        { ...childB, children: [] },
      ],
    };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [childA, childB],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/root (1).md",
    ]);
  });

  it("reuses an existing Markdown file when its frontmatter belongs to the same Confluence page", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Root.md"),
      readExistingFile: () =>
        Promise.resolve(`---
confluence:
  pageId: "100"
---

Old content
`),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("adds a suffix when an existing Markdown file belongs to a different Confluence page", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Root.md"),
      readExistingFile: () =>
        Promise.resolve(`---
confluence:
  pageId: "999"
---

Other content
`),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root (1).md"]);
  });

  it("reuses an existing Markdown file with flat Confluence properties", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Root.md"),
      readExistingFile: () =>
        Promise.resolve(`---
confluencePageId: "100"
---

Old content
`),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("collects page nodes from a folder root tree", async () => {
    const childPage = createPage({ pageId: "200", title: "Child", parentId: "folder-100", depth: 1 });
    const root: ConfluenceFolderContentTreeNode = {
      nodeType: "folder",
      contentId: "folder-100",
      title: "Folder Root",
      parentId: null,
      depth: 0,
      childPosition: 0,
      children: [{ ...childPage, children: [] }],
    };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Folder Root",
      root,
      pages: [childPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual(["confluence/Folder Root/Child.md"]);
  });

  it("creates nested folder paths that preserve the Confluence page tree", async () => {
    const parentPage = createPage({ pageId: "100", title: "Parent" });
    const childPage = createPage({ pageId: "200", title: "Child", parentId: "100", depth: 1 });
    const grandchildPage = createPage({ pageId: "300", title: "Grandchild", parentId: "200", depth: 2 });
    const root: ConfluencePageTreeNode = {
      ...parentPage,
      children: [{ ...childPage, children: [{ ...grandchildPage, children: [] }] }],
    };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [parentPage, childPage, grandchildPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Parent.md",
      "confluence/Root/Parent/Child.md",
      "confluence/Root/Parent/Child/Grandchild.md",
    ]);
  });

  it("uses the assigned parent Markdown filename as the child folder when the parent filename collides", async () => {
    const parentPage = createPage({ pageId: "100", title: "Parent" });
    const childPage = createPage({ pageId: "200", title: "Child", parentId: "100", depth: 1 });
    const root: ConfluencePageTreeNode = {
      ...parentPage,
      children: [{ ...childPage, children: [] }],
    };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [parentPage, childPage],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Parent.md"),
      readExistingFile: () =>
        Promise.resolve(`---
confluencePageId: "999"
---

Other content
`),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Parent (1).md",
      "confluence/Root/Parent (1)/Child.md",
    ]);
  });

  it("appends pages that are missing from the root tree in pages array order", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const missingFirst = createPage({ pageId: "200", title: "Missing First", depth: 1, childPosition: 0 });
    const missingSecond = createPage({ pageId: "300", title: "Missing Second", depth: 1, childPosition: 1 });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, missingFirst, missingSecond],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files.map((file) => file.pageId)).toEqual(["100", "200", "300"]);
    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/Missing First.md",
      "confluence/Root/Missing Second.md",
    ]);
  });

  it("uses assigned Markdown filenames as Confluence page link targets", async () => {
    const rootPage = createPage({
      pageId: "100",
      title: "Root",
      bodyStorageValue: `
        <p>
          <ac:link>
            <ri:page ri:content-title="Team: API / Sync?" />
            <ac:link-body>API Sync</ac:link-body>
          </ac:link>
        </p>
      `,
    });
    const linkedPage = createPage({
      pageId: "200",
      title: "Team: API / Sync?",
      parentId: "100",
      depth: 1,
      childPosition: 0,
    });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [{ ...linkedPage, children: [] }] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, linkedPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files[0]?.content).toContain("[[confluence/Root/Root/Team API Sync|API Sync]]");
    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/Root/Team API Sync.md",
    ]);
  });

  it("uses existing page paths before resolving links when a page title changed locally", async () => {
    const rootPage = createPage({
      pageId: "100",
      title: "New Root",
      bodyStorageValue: `
        <p>
          <ac:link>
            <ri:page ri:content-title="Child" />
            <ac:link-body>Child Page</ac:link-body>
          </ac:link>
        </p>
      `,
    });
    const childPage = createPage({
      pageId: "200",
      title: "Child",
      parentId: "100",
      depth: 1,
      childPosition: 0,
    });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [{ ...childPage, children: [] }] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, childPage],
      existingPagePathById: new Map([
        ["100", "confluence/Root/Old Root.md"],
        ["200", "confluence/Root/Old Root/Old Child.md"],
      ]),
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Old Root.md",
      "confluence/Root/Old Root/Old Child.md",
    ]);
    expect(result.files[0]?.content).toContain("[[confluence/Root/Old Root/Old Child|Child Page]]");
  });

  it("uses the Confluence source host when converting Jira issue macros", async () => {
    const rootPage = createPage({
      pageId: "100",
      title: "Root",
      sourceUrl: "https://selta.atlassian.net/wiki/spaces/IS/pages/100/Root",
      bodyStorageValue: `
        <p>
          관련 이슈:
          <ac:structured-macro ac:name="jira">
            <ac:parameter ac:name="key">IS-1251</ac:parameter>
          </ac:structured-macro>
        </p>
      `,
    });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files[0]?.content).toContain("관련 이슈: [IS-1251](https://selta.atlassian.net/browse/IS-1251)");
    expect(result.files[0]?.warnings).toEqual([]);
  });

  it("does not loop forever when the provided tree contains a page cycle", async () => {
    const cyclicPage = createPage({ pageId: "100", title: "Root" });
    const root = { ...cyclicPage, children: [] } as ConfluencePageTreeNode;
    root.children.push(root);

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [cyclicPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files.map((file) => file.pageId)).toEqual(["100"]);
  });

  it("returns conversion warning issues for unsupported macros", async () => {
    const page = createPage({
      pageId: "100",
      title: "Root",
      bodyStorageValue: '<ac:structured-macro ac:name="toc" />',
    });

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root: { ...page, children: [] },
      pages: [page],
      pathExists: () => Promise.resolve(false),
    });

    expect(result.files).toHaveLength(1);
    expect(result.conversionIssues).toEqual([
      {
        severity: "warning",
        pageId: "100",
        title: "Root",
        message: "지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: toc",
      },
    ]);
  });

  it("continues other pages when one page conversion fails", async () => {
    const rootPage = createPage({
      pageId: "100",
      title: "Root",
      bodyStorageValue: "<p>Root</p>",
    });
    const childPage = createPage({
      pageId: "200",
      title: "Broken",
      parentId: "100",
      versionNumber: 1,
      bodyStorageValue: "<p>Broken</p>",
      sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/200/Broken",
      depth: 1,
      childPosition: 0,
    });

    const result = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root: { ...rootPage, children: [{ ...childPage, children: [] }] },
      pages: [rootPage, childPage],
      pathExists: () => Promise.resolve(false),
      convertStorageToMarkdown: (storageValue) => {
        if (storageValue.includes("Broken")) {
          throw new Error("parse failed");
        }

        return { markdown: "Root", warnings: [] };
      },
    });

    expect(result.files.map((file) => file.pageId)).toEqual(["100"]);
    expect(result.conversionIssues).toEqual([
      {
        severity: "error",
        pageId: "200",
        title: "Broken",
        message: "Confluence storage를 Markdown으로 변환할 수 없습니다: parse failed",
      },
    ]);
  });
});

describe("createPageMarkdownContent", () => {
  it("creates frontmatter and body for a single pulled page", () => {
    const content = createPageMarkdownContent({
      pageId: "100",
      title: "Root",
      versionNumber: 4,
      sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
      parentId: null,
      bodyMarkdown: "Hello\n",
    });

    expect(content).toBe(`---
confluencePageId: "100"
confluenceTitle: "Root"
confluenceVersion: 4
confluenceSourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root"
confluenceParentId: null
confluenceContentHash: "${calculateMarkdownBodyHash("Hello\n")}"
---

Hello
`);
  });
});

describe("createDetachedPageBackupMarkdown", () => {
  it("removes Confluence frontmatter and prepends detached backup notice", () => {
    const backup = createDetachedPageBackupMarkdown(`---
confluencePageId: "100"
confluenceVersion: 3
confluenceContentHash: "sha256:old"
---

Local draft
`);

    expect(backup).toBe(`# Confluence 연결이 해제된 백업본

이 파일은 Pull Current Page 실행 전에 보존한 로컬 수정본입니다. Confluence pageId, version, content hash metadata를 제거했으므로 Push/Pull 대상이 아닙니다.

Local draft
`);
  });
});

describe("createCurrentPageBackupPath", () => {
  it("adds timestamp and suffix before markdown extension", () => {
    expect(
      createCurrentPageBackupPath(
        "confluence/Root/Page.md",
        new Date("2026-04-29T10:11:12.000Z"),
        2,
      ),
    ).toBe("confluence/Root/Page.local-backup-2026-04-29T10-11-12-000Z (2).md");
  });
});

describe("updatePageMarkdownFrontmatterAfterPush", () => {
  it("updates confluenceVersion and confluenceContentHash while preserving body", () => {
    const original = `---
confluencePageId: "100"
confluenceTitle: "Root"
confluenceVersion: 3
confluenceContentHash: "sha256:old"
---

Hello
`;

    expect(
      updatePageMarkdownFrontmatterAfterPush(original, {
        versionNumber: 4,
        contentHash: "sha256:new",
      }),
    ).toBe(`---
confluencePageId: "100"
confluenceTitle: "Root"
confluenceVersion: 4
confluenceContentHash: "sha256:new"
---

Hello
`);
  });

  it("adds missing confluenceContentHash after confluenceVersion", () => {
    const original = `---
confluencePageId: "100"
confluenceVersion: 3
---

Hello
`;

    expect(
      updatePageMarkdownFrontmatterAfterPush(original, {
        versionNumber: 4,
        contentHash: "sha256:new",
      }),
    ).toBe(`---
confluencePageId: "100"
confluenceVersion: 4
confluenceContentHash: "sha256:new"
---

Hello
`);
  });

  it("updates indented existing keys without adding duplicates", () => {
    const original = `---
confluencePageId: "100"
  confluenceVersion: 3
  confluenceContentHash: "sha256:old"
---

Hello
`;

    expect(
      updatePageMarkdownFrontmatterAfterPush(original, {
        versionNumber: 4,
        contentHash: "sha256:new",
      }),
    ).toBe(`---
confluencePageId: "100"
confluenceVersion: 4
confluenceContentHash: "sha256:new"
---

Hello
`);
  });

  it("preserves nested legacy pageId while adding top-level push metadata", () => {
    const original = `---
confluence:
  pageId: "100"
---

Legacy body
`;

    expect(
      updatePageMarkdownFrontmatterAfterPush(original, {
        versionNumber: 4,
        contentHash: "sha256:new",
      }),
    ).toBe(`---
confluence:
  pageId: "100"
confluenceVersion: 4
confluenceContentHash: "sha256:new"
---

Legacy body
`);
  });

  it("returns null when the file has no frontmatter", () => {
    expect(
      updatePageMarkdownFrontmatterAfterPush("Hello\n", {
        versionNumber: 4,
        contentHash: "sha256:new",
      }),
    ).toBeNull();
  });
});
