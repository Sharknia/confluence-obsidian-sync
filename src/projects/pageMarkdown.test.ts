import { describe, expect, it } from "vitest";
import type {
  ConfluenceFolderContentTreeNode,
  ConfluencePageTreeNode,
  ConfluencePageTreePage,
} from "../confluence/pageTree";
import { buildPageMarkdownFiles, createSafeMarkdownFileName } from "./pageMarkdown";

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

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(files).toEqual([
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
---

Hello
`,
      },
    ]);
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

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, childA, childB],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Same.md"),
    });

    expect(files.map((file) => file.vaultPath)).toEqual([
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

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [childA, childB],
      pathExists: () => Promise.resolve(false),
    });

    expect(files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/root (1).md",
    ]);
  });

  it("reuses an existing Markdown file when its frontmatter belongs to the same Confluence page", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const files = await buildPageMarkdownFiles({
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

    expect(files.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("adds a suffix when an existing Markdown file belongs to a different Confluence page", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const files = await buildPageMarkdownFiles({
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

    expect(files.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root (1).md"]);
  });

  it("reuses an existing Markdown file with flat Confluence properties", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const files = await buildPageMarkdownFiles({
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

    expect(files.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
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

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Folder Root",
      root,
      pages: [childPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(files.map((file) => file.vaultPath)).toEqual(["confluence/Folder Root/Child.md"]);
  });

  it("creates nested folder paths that preserve the Confluence page tree", async () => {
    const parentPage = createPage({ pageId: "100", title: "Parent" });
    const childPage = createPage({ pageId: "200", title: "Child", parentId: "100", depth: 1 });
    const grandchildPage = createPage({ pageId: "300", title: "Grandchild", parentId: "200", depth: 2 });
    const root: ConfluencePageTreeNode = {
      ...parentPage,
      children: [{ ...childPage, children: [{ ...grandchildPage, children: [] }] }],
    };

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [parentPage, childPage, grandchildPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(files.map((file) => file.vaultPath)).toEqual([
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

    const files = await buildPageMarkdownFiles({
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

    expect(files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Parent (1).md",
      "confluence/Root/Parent (1)/Child.md",
    ]);
  });

  it("appends pages that are missing from the root tree in pages array order", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const missingFirst = createPage({ pageId: "200", title: "Missing First", depth: 1, childPosition: 0 });
    const missingSecond = createPage({ pageId: "300", title: "Missing Second", depth: 1, childPosition: 1 });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, missingFirst, missingSecond],
      pathExists: () => Promise.resolve(false),
    });

    expect(files.map((file) => file.pageId)).toEqual(["100", "200", "300"]);
    expect(files.map((file) => file.vaultPath)).toEqual([
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

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, linkedPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(files[0]?.content).toContain("[[confluence/Root/Root/Team API Sync|API Sync]]");
    expect(files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/Root/Team API Sync.md",
    ]);
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

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(files[0]?.content).toContain("관련 이슈: [IS-1251](https://selta.atlassian.net/browse/IS-1251)");
    expect(files[0]?.warnings).toEqual([]);
  });

  it("does not loop forever when the provided tree contains a page cycle", async () => {
    const cyclicPage = createPage({ pageId: "100", title: "Root" });
    const root = { ...cyclicPage, children: [] } as ConfluencePageTreeNode;
    root.children.push(root);

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [cyclicPage],
      pathExists: () => Promise.resolve(false),
    });

    expect(files.map((file) => file.pageId)).toEqual(["100"]);
  });
});
