# Confluence Page Markdown Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confluence에서 내려받은 페이지 본문을 Obsidian에서 편집 가능한 Markdown 파일로 저장한다.

**Architecture:** Epic 4의 트리 Pull 유스케이스는 페이지 메타데이터와 storage 본문을 함께 반환하도록 확장한다. Confluence storage XHTML 변환, Markdown/frontmatter 조립, vault 파일 저장은 각각 `src/markdown`과 `src/projects`의 순수 로직으로 분리하고, Obsidian 명령은 이 유스케이스를 호출만 한다.

**Tech Stack:** TypeScript, Confluence Cloud REST API v2 `body-format=storage`, `linkedom`, Obsidian Vault API, Vitest, ESLint, pnpm

---

## Scope

Epic 5의 완료 기준만 구현한다.

- 페이지 1개를 Markdown 파일 1개로 저장한다.
- frontmatter에 Confluence 메타데이터를 기록한다.
- 제목, 문단, 링크, 리스트, 코드 블록, 기본 표를 Markdown으로 변환한다.
- 파일명으로 쓸 수 없는 문자를 정리한다.
- 동일 제목 충돌을 처리한다.
- 변환 손실 가능성이 있는 macro는 명확히 표시한다.

반복 Pull 갱신 정책, 안전 삭제, 로컬 수정 보호, Push 변환은 Epic 6 이후에서 구현한다. 이 계획에서는 Pull 실행 시 현재 조회된 페이지를 새 Markdown 파일로 쓰는 데 집중한다. 같은 경로가 이미 존재하면 덮어쓰기 대신 충돌 suffix를 붙인다.
macro 변환 손실 표시는 Markdown 본문 warning block과 Pull 결과 Notice의 경고 개수로 처리한다. 손실 경고를 frontmatter에 구조화해 저장하는 정책은 Push/검증 흐름이 구체화되는 Epic 8 이후에 결정한다.

## External API Notes

- Atlassian 공식 Confluence Cloud REST API v2 `GET /wiki/api/v2/pages/{id}`는 `body-format` query parameter를 제공한다.
- 본문 변환의 입력은 `GET /wiki/api/v2/pages/{id}?body-format=storage`의 `body.storage.value`이다.
- storage body는 Confluence XHTML 기반 표현이다. 이 계획의 Markdown 변환 대상은 MVP 기준으로 제한한다.

## File Structure

- Modify: `src/confluence/pageTree.ts`
  - page detail 요청에 `body-format=storage`를 추가하고 `ConfluencePageTreePage.bodyStorageValue`를 채운다.
- Modify: `src/confluence/pageTree.test.ts`
  - root/descendant page detail 응답에 storage body를 추가하고 invalid body 응답을 검증한다.
- Create: `src/markdown/confluenceStorageToMarkdown.ts`
  - Confluence storage XHTML 문자열을 Markdown 문자열과 변환 경고 목록으로 변환한다.
- Create: `src/markdown/confluenceStorageToMarkdown.test.ts`
  - 제목, 문단, 링크, 리스트, 코드 블록, 표, macro 표시 변환을 검증한다.
- Modify: `package.json`
  - Node 테스트 환경에서도 storage XHTML을 안정적으로 파싱하기 위해 `linkedom` 의존성을 추가한다.
- Modify: `pnpm-lock.yaml`
  - `linkedom` lockfile 변경을 반영한다.
- Create: `src/projects/pageMarkdown.ts`
  - frontmatter 생성, 파일명 정리, 충돌 없는 Markdown 경로 계산, 최종 파일 내용 조립을 담당한다.
- Create: `src/projects/pageMarkdown.test.ts`
  - frontmatter, 파일명 sanitizing, 동일 제목 충돌 suffix를 검증한다.
- Modify: `src/projects/projectStorage.ts`
  - 기존 storage adapter를 Markdown 파일 저장에도 재사용할 수 있도록 `writeMarkdownPages`를 추가한다.
- Modify: `src/projects/projectStorage.test.ts`
  - 폴더 생성과 파일 쓰기 순서, 쓰기 실패 결과를 검증한다.
- Modify: `src/commands/pullTreeCommand.ts`
  - Pull 결과를 프로젝트 폴더 아래 Markdown 파일로 저장하고 Notice에 저장 개수를 표시한다.
- Modify: `src/commands/pullTreeCommand.test.ts`
  - 저장 성공/실패 Notice와 storage 호출을 검증한다.
- Modify: `src/main.ts`
  - Obsidian Vault API를 `ProjectStorageAdapter`로 연결해 `runPullTreeCommand`에 전달한다.
- Modify: `docs/mvp-epics.md`
  - Epic 5 구현 계획 링크를 추가한다.

## Data Shape

```typescript
export interface ConfluencePageTreePage {
  pageId: string;
  title: string;
  parentId: string | null;
  versionNumber: number;
  sourceUrl: string;
  depth: number;
  childPosition: number;
  bodyStorageValue: string;
}

export interface MarkdownConversionWarning {
  type: "unsupported-macro";
  name: string;
}

export interface PageMarkdownFile {
  pageId: string;
  title: string;
  vaultPath: string;
  content: string;
  warnings: MarkdownConversionWarning[];
}
```

## Pseudocode

```text
function runPullTreeCommand(settings, fetchTree, storage, showNotice):
  validate connection settings
  validate current project
  result = fetchTree(settings, rootContentType, rootContentId)
  if result is failure:
    show result.message
    return

  markdownFiles = buildMarkdownFilesForPages(projectFolder, result.root, result.pages, storage.exists)
  writeMarkdownPages(storage, markdownFiles)
  show "Confluence 페이지를 Markdown으로 저장했습니다: N개"

function buildMarkdownFilesForPages(projectRootPath, rootNode, pages, pathExists):
  pagesById = map pages by pageId
  reservedPaths = empty set
  orderedPageIds = traverse rootNode and collect only page nodes
  missingPageIds = pages that are not reachable from rootNode

  for page in orderedPageIds then missingPageIds:
    folderPath = projectRootPath
    baseFileName = sanitize page.title or "confluence-page-{pageId}"
    candidate = folderPath + baseFileName + ".md"
    while candidate exists or candidate in reservedPaths:
      candidate = folderPath + baseFileName + " ({index}).md"
    markdown = convertConfluenceStorageToMarkdown(page.bodyStorageValue)
    content = frontmatter(page metadata) + markdown
    reserve candidate
    append file

  return files
```

MVP에서는 페이지 계층을 폴더 구조로 복제하지 않고, 현재 프로젝트 폴더 바로 아래에 페이지당 Markdown 파일 1개를 평탄하게 저장한다. 반복 Pull에서 기존 파일 갱신과 이동/삭제 정책은 Epic 6에서 다룬다.

## Task 1: Confluence page detail에 storage 본문 포함

**Files:**
- Modify: `src/confluence/pageTree.ts`
- Modify: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Write failing tests for storage body mapping**

Update root-only and descendant success fixtures in `src/confluence/pageTree.test.ts` so every page detail response contains `body.storage.value`, and every expected `ConfluencePageTreePage` contains `bodyStorageValue`.

```typescript
{
  status: 200,
  json: {
    id: "100",
    title: "Root",
    spaceId: "SPACE",
    version: { number: 3 },
    body: { storage: { value: "<h1>Root</h1><p>Hello</p>" } },
    _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
  }
}
```

Expected page object:

```typescript
{
  pageId: "100",
  title: "Root",
  parentId: null,
  versionNumber: 3,
  sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
  depth: 0,
  childPosition: 0,
  bodyStorageValue: "<h1>Root</h1><p>Hello</p>"
}
```

Add this invalid response test:

```typescript
it("fails when the root page detail does not include storage body", async () => {
  const { transport } = createSequencedTransport([
    {
      status: 200,
      json: {
        id: "100",
        title: "Root",
        version: { number: 3 },
        body: { storage: {} },
        _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
      }
    }
  ]);

  const result = await fetchConfluencePageTree(createSettings(), "100", transport);

  expect(result).toEqual({
    ok: false,
    reason: "invalid-response",
    message: "Confluence 루트 페이지 응답 형식이 올바르지 않습니다."
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: FAIL because `bodyStorageValue` is not defined and the request URL does not include `body-format=storage`.

- [ ] **Step 3: Implement page detail body parsing**

Modify `src/confluence/pageTree.ts`:

```typescript
interface PageDetailApiResponse {
  id?: unknown;
  title?: unknown;
  version?: {
    number?: unknown;
  } | null;
  body?: {
    storage?: {
      value?: unknown;
    } | null;
  } | null;
  _links?: {
    webui?: unknown;
  } | null;
}

function createPageDetailRequest(settings: ConfluenceSyncSettings, pageId: string) {
  return {
    url: buildConfluenceApiUrl(
      settings.confluenceBaseUrl,
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`
    ),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function isPageDetailApiResponse(value: unknown): value is PageDetailApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as PageDetailApiResponse;

  if (typeof response.id !== "string" || typeof response.title !== "string") {
    return false;
  }

  if (typeof response.version !== "object" || response.version === null) {
    return false;
  }

  if (typeof response.version.number !== "number") {
    return false;
  }

  if (typeof response.body?.storage?.value !== "string") {
    return false;
  }

  return typeof response._links === "object" || response._links === undefined || response._links === null;
}
```

Add `bodyStorageValue` in `toRootPage` and `toDescendantPage`:

```typescript
bodyStorageValue: response.body?.storage?.value as string
```

```typescript
bodyStorageValue: detail.body?.storage?.value as string
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/confluence/pageTree.ts src/confluence/pageTree.test.ts
git commit -m "feat: include confluence storage body in page tree"
```

## Task 2: Confluence storage XHTML을 Markdown으로 변환

**Files:**
- Create: `src/markdown/confluenceStorageToMarkdown.ts`
- Create: `src/markdown/confluenceStorageToMarkdown.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add HTML parser dependency**

Run:

```bash
pnpm add linkedom
```

Expected: `package.json` and `pnpm-lock.yaml` include `linkedom`.

- [ ] **Step 2: Write failing conversion tests**

Create `src/markdown/confluenceStorageToMarkdown.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { convertConfluenceStorageToMarkdown } from "./confluenceStorageToMarkdown";

describe("convertConfluenceStorageToMarkdown", () => {
  it("converts headings, paragraphs, links, lists, code blocks, tables, and unsupported macros", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <h1>문서 제목</h1>
      <p>Hello <a href="https://example.com">Example</a></p>
      <ul><li>첫째</li><li>둘째</li></ul>
      <ol><li>하나</li><li>둘</li></ol>
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">typescript</ac:parameter>
        <ac:plain-text-body><![CDATA[const value = 1;]]></ac:plain-text-body>
      </ac:structured-macro>
      <table>
        <tbody>
          <tr><th>이름</th><th>값</th></tr>
          <tr><td>A</td><td>1</td></tr>
        </tbody>
      </table>
      <ac:structured-macro ac:name="toc" />
    `);

    expect(result.markdown).toBe(`# 문서 제목

Hello [Example](https://example.com)

- 첫째
- 둘째

1. 하나
2. 둘

\`\`\`typescript
const value = 1;
\`\`\`

| 이름 | 값 |
| --- | --- |
| A | 1 |

> [!warning] Confluence macro not converted: toc
`);
    expect(result.warnings).toEqual([{ type: "unsupported-macro", name: "toc" }]);
  });

  it("escapes markdown table pipes inside cells", () => {
    const result = convertConfluenceStorageToMarkdown("<table><tbody><tr><td>A | B</td><td>2</td></tr></tbody></table>");

    expect(result.markdown).toBe(`| A \\| B | 2 |
| --- | --- |
`);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/markdown/confluenceStorageToMarkdown.test.ts
```

Expected: FAIL because the converter file does not exist.

- [ ] **Step 4: Implement converter with linkedom**

Create `src/markdown/confluenceStorageToMarkdown.ts`:

```typescript
import { parseHTML } from "linkedom";

export interface MarkdownConversionWarning {
  type: "unsupported-macro";
  name: string;
}

export interface MarkdownConversionResult {
  markdown: string;
  warnings: MarkdownConversionWarning[];
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export function convertConfluenceStorageToMarkdown(storageValue: string): MarkdownConversionResult {
  const { document } = parseHTML(`<body>${storageValue}</body>`);
  const warnings: MarkdownConversionWarning[] = [];
  const body = document.body;
  const blocks = Array.from(body.childNodes)
    .map((node) => renderNode(node, warnings, 0))
    .filter((block) => block.trim().length > 0);

  return {
    markdown: `${blocks.join("\n\n").trimEnd()}\n`,
    warnings
  };
}

function renderNode(node: Node, warnings: MarkdownConversionWarning[], listDepth: number): string {
  if (node.nodeType === TEXT_NODE) {
    return normalizeInlineWhitespace(node.textContent ?? "");
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const tagName = element.tagName.toUpperCase();

  if (tagName.match(/^H[1-6]$/u) !== null) {
    return `${"#".repeat(Number(tagName.slice(1)))} ${renderInlineChildren(element, warnings, listDepth).trim()}`;
  }

  if (tagName === "P") {
    return renderInlineChildren(element, warnings, listDepth).trim();
  }

  if (tagName === "A") {
    const label = renderInlineChildren(element, warnings, listDepth).trim();
    const href = element.getAttribute("href") ?? "";
    return href.length > 0 ? `[${label}](${href})` : label;
  }

  if (tagName === "UL" || tagName === "OL") {
    return renderList(element, warnings, listDepth, tagName === "OL");
  }

  if (tagName === "TABLE") {
    return renderTable(element, warnings, listDepth);
  }

  if (tagName === "AC:STRUCTURED-MACRO") {
    return renderMacro(element, warnings);
  }

  return renderInlineChildren(element, warnings, listDepth).trim();
}

function renderInlineChildren(element: Element, warnings: MarkdownConversionWarning[], listDepth: number): string {
  return Array.from(element.childNodes)
    .map((child) => renderNode(child, warnings, listDepth))
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n");
}

function renderList(element: Element, warnings: MarkdownConversionWarning[], listDepth: number, ordered: boolean): string {
  const items = Array.from(element.children).filter((child) => child.tagName.toUpperCase() === "LI");

  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : "-";
      const indent = "  ".repeat(listDepth);
      const content = Array.from(item.childNodes)
        .map((child) => renderNode(child, warnings, listDepth + 1))
        .join("")
        .trim();

      return `${indent}${marker} ${content}`;
    })
    .join("\n");
}

function renderTable(element: Element, warnings: MarkdownConversionWarning[], listDepth: number): string {
  const rows = Array.from(element.querySelectorAll("tr")).map((row) =>
    Array.from(row.children)
      .filter((cell) => ["TH", "TD"].includes(cell.tagName.toUpperCase()))
      .map((cell) => escapeTableCell(renderInlineChildren(cell, warnings, listDepth).trim()))
  );
  const visibleRows = rows.filter((row) => row.length > 0);

  if (visibleRows.length === 0) {
    return "";
  }

  const columnCount = Math.max(...visibleRows.map((row) => row.length));
  const normalizedRows = visibleRows.map((row) => normalizeTableRow(row, columnCount));
  const [firstRow, ...remainingRows] = normalizedRows;

  return [
    renderMarkdownTableRow(firstRow),
    renderMarkdownTableRow(Array.from({ length: columnCount }, () => "---")),
    ...remainingRows.map(renderMarkdownTableRow)
  ].join("\n");
}

function renderMacro(element: Element, warnings: MarkdownConversionWarning[]): string {
  const macroName = element.getAttribute("ac:name") ?? "unknown";

  if (macroName === "code") {
    const language = findConfluenceMacroParameter(element, "language")?.textContent?.trim() ?? "";
    const code = findFirstDescendantByTagName(element, "AC:PLAIN-TEXT-BODY")?.textContent?.trim() ?? "";

    return `\`\`\`${language}\n${code}\n\`\`\``;
  }

  warnings.push({ type: "unsupported-macro", name: macroName });

  return `> [!warning] Confluence macro not converted: ${macroName}`;
}

function findConfluenceMacroParameter(element: Element, parameterName: string): Element | null {
  return findFirstDescendant(
    element,
    (candidate) =>
      candidate.tagName.toUpperCase() === "AC:PARAMETER" && candidate.getAttribute("ac:name") === parameterName
  );
}

function findFirstDescendantByTagName(element: Element, tagName: string): Element | null {
  return findFirstDescendant(element, (candidate) => candidate.tagName.toUpperCase() === tagName);
}

function findFirstDescendant(element: Element, predicate: (candidate: Element) => boolean): Element | null {
  for (const child of Array.from(element.children)) {
    if (predicate(child)) {
      return child;
    }

    const nestedMatch = findFirstDescendant(child, predicate);

    if (nestedMatch !== null) {
      return nestedMatch;
    }
  }

  return null;
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\n+/gu, "<br>");
}

function normalizeTableRow(row: string[], columnCount: number): string[] {
  return [...row, ...Array.from({ length: columnCount - row.length }, () => "")];
}

function renderMarkdownTableRow(row: string[]): string {
  return `| ${row.join(" | ")} |`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/markdown/confluenceStorageToMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/markdown/confluenceStorageToMarkdown.ts src/markdown/confluenceStorageToMarkdown.test.ts
git commit -m "feat: convert confluence storage to markdown"
```

## Task 3: Markdown 파일명, frontmatter, 파일 내용 생성

**Files:**
- Create: `src/projects/pageMarkdown.ts`
- Create: `src/projects/pageMarkdown.test.ts`

- [ ] **Step 1: Write failing page Markdown tests**

Create `src/projects/pageMarkdown.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildPageMarkdownFiles, createSafeMarkdownFileName } from "./pageMarkdown";
import type {
  ConfluenceFolderContentTreeNode,
  ConfluencePageTreeNode,
  ConfluencePageTreePage
} from "../confluence/pageTree";

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
    ...overrides
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
});

describe("buildPageMarkdownFiles", () => {
  it("creates frontmatter and markdown content for each page", async () => {
    const rootPage = createPage({ pageId: "100", title: "Root" });
    const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage],
      pathExists: () => Promise.resolve(false)
    });

    expect(files).toEqual([
      {
        pageId: "100",
        title: "Root",
        vaultPath: "confluence/Root/Root.md",
        warnings: [],
        content: `---
confluence:
  pageId: "100"
  title: "Root"
  version: 1
  sourceUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/100/Root"
  parentId: null
---

Hello
`
      }
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
        { ...childB, children: [] }
      ]
    };

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Root",
      root,
      pages: [rootPage, childA, childB],
      pathExists: (path) => Promise.resolve(path === "confluence/Root/Same.md")
    });

    expect(files.map((file) => file.vaultPath)).toEqual([
      "confluence/Root/Root.md",
      "confluence/Root/Same (1).md",
      "confluence/Root/Same (2).md"
    ]);
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
      children: [{ ...childPage, children: [] }]
    };

    const files = await buildPageMarkdownFiles({
      projectRootPath: "confluence/Folder Root",
      root,
      pages: [childPage],
      pathExists: () => Promise.resolve(false)
    });

    expect(files.map((file) => file.vaultPath)).toEqual(["confluence/Folder Root/Child.md"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/projects/pageMarkdown.test.ts
```

Expected: FAIL because `pageMarkdown.ts` does not exist.

- [ ] **Step 3: Implement page Markdown builder**

Create `src/projects/pageMarkdown.ts`:

```typescript
import { convertConfluenceStorageToMarkdown, type MarkdownConversionWarning } from "../markdown/confluenceStorageToMarkdown";
import type {
  ConfluenceFolderContentTreeNode,
  ConfluencePageTreeNode,
  ConfluencePageTreePage
} from "../confluence/pageTree";

const MAX_SAFE_FILE_BASE_NAME_LENGTH = 120;
const WINDOWS_RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

export interface PageMarkdownFile {
  pageId: string;
  title: string;
  vaultPath: string;
  content: string;
  warnings: MarkdownConversionWarning[];
}

export interface BuildPageMarkdownFilesInput {
  projectRootPath: string;
  root: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode;
  pages: ConfluencePageTreePage[];
  pathExists: (path: string) => Promise<boolean>;
}

export function createSafeMarkdownFileName(title: string, pageId: string): string {
  const safeBaseName = createSafePathSegment(title, `confluence-page-${pageId}`);

  return `${safeBaseName}.md`;
}

export async function buildPageMarkdownFiles(input: BuildPageMarkdownFilesInput): Promise<PageMarkdownFile[]> {
  const files: PageMarkdownFile[] = [];
  const reservedPaths = new Set<string>();
  const pagesById = new Map(input.pages.map((page) => [page.pageId, page]));
  const orderedPageIds = collectTreePageIds(input.root);
  const missingPageIds = input.pages
    .map((page) => page.pageId)
    .filter((pageId) => !orderedPageIds.includes(pageId));
  const pageIdsToWrite = [...orderedPageIds, ...missingPageIds];

  for (const pageId of pageIdsToWrite) {
    const page = pagesById.get(pageId);

    if (page === undefined) {
      continue;
    }

    const vaultPath = await createAvailableMarkdownPath(input.projectRootPath, page, reservedPaths, input.pathExists);
    const conversion = convertConfluenceStorageToMarkdown(page.bodyStorageValue);

    reservedPaths.add(vaultPath);
    files.push({
      pageId: page.pageId,
      title: page.title,
      vaultPath,
      warnings: conversion.warnings,
      content: `${createFrontmatter(page)}\n${conversion.markdown}`
    });
  }

  return files;
}

function collectTreePageIds(root: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode): string[] {
  const pageIds: string[] = [];
  const pendingNodes: Array<ConfluencePageTreeNode | ConfluenceFolderContentTreeNode> = [root];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.shift();

    if (node === undefined) {
      continue;
    }

    if (isPageTreeNode(node)) {
      pageIds.push(node.pageId);
    }

    pendingNodes.unshift(...node.children);
  }

  return pageIds;
}

function isPageTreeNode(
  node: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode
): node is ConfluencePageTreeNode {
  return "pageId" in node;
}

async function createAvailableMarkdownPath(
  projectRootPath: string,
  page: ConfluencePageTreePage,
  reservedPaths: Set<string>,
  pathExists: (path: string) => Promise<boolean>
): Promise<string> {
  const baseName = createSafeMarkdownFileName(page.title, page.pageId).replace(/\.md$/u, "");
  let collisionIndex = 0;

  while (true) {
    const suffix = collisionIndex === 0 ? "" : ` (${collisionIndex})`;
    const candidatePath = `${projectRootPath}/${baseName}${suffix}.md`;

    if (!reservedPaths.has(candidatePath) && !(await pathExists(candidatePath))) {
      return candidatePath;
    }

    collisionIndex += 1;
  }
}

function createFrontmatter(page: ConfluencePageTreePage): string {
  return `---
confluence:
  pageId: ${JSON.stringify(page.pageId)}
  title: ${JSON.stringify(page.title)}
  version: ${page.versionNumber}
  sourceUrl: ${JSON.stringify(page.sourceUrl)}
  parentId: ${page.parentId === null ? "null" : JSON.stringify(page.parentId)}
---`;
}

function createSafePathSegment(value: string, fallback: string): string {
  const sanitizedValue = value.replace(/[<>:"/\\|?*\u0000-\u001F]+/gu, " ");
  const normalizedValue = sanitizedValue
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "")
    .slice(0, MAX_SAFE_FILE_BASE_NAME_LENGTH);

  if (
    normalizedValue.length > 0 &&
    normalizedValue !== "." &&
    normalizedValue !== ".." &&
    !WINDOWS_RESERVED_FILE_NAMES.has(normalizedValue.toUpperCase())
  ) {
    return normalizedValue;
  }

  return fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/projects/pageMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projects/pageMarkdown.ts src/projects/pageMarkdown.test.ts
git commit -m "feat: build markdown files for confluence pages"
```

## Task 4: Markdown 파일을 vault storage에 저장

**Files:**
- Modify: `src/projects/projectStorage.ts`
- Modify: `src/projects/projectStorage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Append to `src/projects/projectStorage.test.ts`:

```typescript
import { writeMarkdownPages } from "./projectStorage";

describe("writeMarkdownPages", () => {
  it("creates parent folders and writes markdown files", async () => {
    const { calls, storage } = createStorageMock();

    const result = await writeMarkdownPages(storage, [
      {
        pageId: "100",
        title: "Root",
        vaultPath: "confluence/Root/Root.md",
        content: "---\nconfluence:\n  pageId: \"100\"\n---\n\nHello\n",
        warnings: []
      }
    ]);

    expect(result).toEqual({ ok: true, writtenFileCount: 1 });
    expect(calls).toEqual([
      "exists:confluence",
      "mkdir:confluence",
      "exists:confluence/Root",
      "mkdir:confluence/Root",
      "write:confluence/Root/Root.md:---\nconfluence:\n  pageId: \"100\"\n---\n\nHello\n"
    ]);
  });

  it("returns storage-error when a markdown file cannot be written", async () => {
    const { storage } = createStorageMock({ failOnWritePath: "confluence/Root/Root.md" });

    const result = await writeMarkdownPages(storage, [
      {
        pageId: "100",
        title: "Root",
        vaultPath: "confluence/Root/Root.md",
        content: "Hello\n",
        warnings: []
      }
    ]);

    expect(result).toEqual({
      ok: false,
      reason: "storage-error",
      message: "Markdown 파일을 저장할 수 없습니다."
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/projects/projectStorage.test.ts
```

Expected: FAIL because `writeMarkdownPages` is not exported.

- [ ] **Step 3: Implement writeMarkdownPages**

Add to `src/projects/projectStorage.ts`:

```typescript
import type { PageMarkdownFile } from "./pageMarkdown";

export interface WriteMarkdownPagesSuccess {
  ok: true;
  writtenFileCount: number;
}

export interface WriteMarkdownPagesFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type WriteMarkdownPagesResult = WriteMarkdownPagesSuccess | WriteMarkdownPagesFailure;

export async function writeMarkdownPages(
  storage: ProjectStorageAdapter,
  files: PageMarkdownFile[]
): Promise<WriteMarkdownPagesResult> {
  try {
    for (const file of files) {
      await ensureParentFoldersExist(storage, file.vaultPath);
      await storage.write(file.vaultPath, file.content);
    }

    return { ok: true, writtenFileCount: files.length };
  } catch {
    return {
      ok: false,
      reason: "storage-error",
      message: "Markdown 파일을 저장할 수 없습니다."
    };
  }
}

async function ensureParentFoldersExist(storage: ProjectStorageAdapter, filePath: string): Promise<void> {
  const segments = filePath.split("/").slice(0, -1);
  const folderPaths = segments.map((_, index) => segments.slice(0, index + 1).join("/"));

  for (const folderPath of folderPaths) {
    await ensureFolderExists(storage, folderPath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/projects/projectStorage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projects/projectStorage.ts src/projects/projectStorage.test.ts
git commit -m "feat: write confluence markdown files"
```

## Task 5: Pull Tree 명령에서 Markdown 저장 실행

**Files:**
- Modify: `src/commands/pullTreeCommand.ts`
- Modify: `src/commands/pullTreeCommand.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing command tests**

Update `RunPullTreeCommandInput` tests in `src/commands/pullTreeCommand.test.ts` to pass a storage mock. Add this success test:

```typescript
it("페이지 트리 조회에 성공하면 Markdown 파일로 저장한다", async () => {
  const notices: string[] = [];
  const writtenFiles: Array<{ path: string; data: string }> = [];
  const storage = {
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    read: () => Promise.reject(new Error("read should not be called")),
    write: (path: string, data: string) => {
      writtenFiles.push({ path, data });
      return Promise.resolve();
    }
  };
  const fetchTree: PullTreeFetcher = () =>
    Promise.resolve({
      ok: true,
      root: {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0,
        bodyStorageValue: "<p>Hello</p>",
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
          childPosition: 0,
          bodyStorageValue: "<p>Hello</p>"
        }
      ],
      errors: []
    });

  await runPullTreeCommand({
    settings: createSettings(),
    fetchTree,
    storage,
    showNotice: (message) => notices.push(message)
  });

  expect(writtenFiles.map((file) => file.path)).toEqual(["confluence/Root/Root.md"]);
  expect(notices).toEqual(["Confluence 페이지를 Markdown으로 저장했습니다: 1개"]);
});
```

Add this failure test:

```typescript
it("Markdown 저장에 실패하면 저장 실패 메시지를 안내한다", async () => {
  const notices: string[] = [];
  const storage = {
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    read: () => Promise.reject(new Error("read should not be called")),
    write: () => Promise.reject(new Error("write failed"))
  };
  const fetchTree: PullTreeFetcher = () =>
    Promise.resolve({
      ok: true,
      root: {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0,
        bodyStorageValue: "<p>Hello</p>",
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
          childPosition: 0,
          bodyStorageValue: "<p>Hello</p>"
        }
      ],
      errors: []
    });

  await runPullTreeCommand({
    settings: createSettings(),
    fetchTree,
    storage,
    showNotice: (message) => notices.push(message)
  });

  expect(notices).toEqual(["Markdown 파일을 저장할 수 없습니다."]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/commands/pullTreeCommand.test.ts
```

Expected: FAIL because `storage` is not accepted and no Markdown files are written.

- [ ] **Step 3: Implement command storage flow**

Modify `src/commands/pullTreeCommand.ts`:

```typescript
import { buildPageMarkdownFiles } from "../projects/pageMarkdown";
import { writeMarkdownPages, type ProjectStorageAdapter } from "../projects/projectStorage";

export interface RunPullTreeCommandInput {
  settings: ConfluenceSyncSettings;
  fetchTree?: PullTreeFetcher;
  storage: ProjectStorageAdapter;
  showNotice: (message: string) => void;
}
```

After `result.ok` succeeds:

```typescript
const currentProjectFolder = currentProject.localFolderPath;
const markdownFiles = await buildPageMarkdownFiles({
  projectRootPath: currentProjectFolder,
  root: result.root,
  pages: result.pages,
  pathExists: (path) => storage.exists(path)
});
const writeResult = await writeMarkdownPages(storage, markdownFiles);

if (!writeResult.ok) {
  showNotice(writeResult.message);
  return;
}

const errorMessage = result.errors.length > 0 ? `, 조회 실패 ${result.errors.length}개` : "";
const warningCount = markdownFiles.reduce((total, file) => total + file.warnings.length, 0);
const warningMessage = warningCount > 0 ? `, 변환 경고 ${warningCount}개` : "";
showNotice(`Confluence 페이지를 Markdown으로 저장했습니다: ${writeResult.writtenFileCount}개${errorMessage}${warningMessage}`);
```

Modify `src/main.ts` to create a vault storage adapter:

```typescript
private createVaultProjectStorageAdapter(): ProjectStorageAdapter {
  return {
    exists: async (path) => this.app.vault.getAbstractFileByPath(path) !== null,
    mkdir: async (path) => {
      await this.app.vault.createFolder(path);
    },
    read: async (path) => this.app.vault.adapter.read(path),
    write: async (path, data) => {
      await this.app.vault.adapter.write(path, data);
    }
  };
}
```

Pass it to `runPullTreeCommand`:

```typescript
storage: this.createVaultProjectStorageAdapter(),
```

- [ ] **Step 4: Run command tests**

Run:

```bash
pnpm exec vitest run src/commands/pullTreeCommand.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/pullTreeCommand.ts src/commands/pullTreeCommand.test.ts src/main.ts
git commit -m "feat: save pulled pages as markdown"
```

## Task 6: Epic 문서 링크와 전체 검증

**Files:**
- Modify: `docs/mvp-epics.md`
- Create: `docs/superpowers/plans/2026-04-27-confluence-page-markdown-save.md`

- [ ] **Step 1: Add Epic 5 implementation plan link**

Modify `docs/mvp-epics.md` under Epic 5:

```markdown
### 구현 계획

- [Confluence Page Markdown Save Implementation Plan](superpowers/plans/2026-04-27-confluence-page-markdown-save.md)
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts src/markdown/confluenceStorageToMarkdown.test.ts src/projects/pageMarkdown.test.ts src/projects/projectStorage.test.ts src/commands/pullTreeCommand.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm run verify
```

Expected: PASS.

- [ ] **Step 4: Prepare current vault**

Run:

```bash
pnpm run prepare:current-vault
```

Expected: PASS.

- [ ] **Step 5: Confirm built plugin contains new save message**

Run:

```bash
rg "Confluence 페이지를 Markdown으로 저장했습니다" .obsidian/plugins/confluence-obsidian-sync/main.js
```

Expected: prints one matching line.

- [ ] **Step 6: Commit**

```bash
git add docs/mvp-epics.md
git add -f docs/superpowers/plans/2026-04-27-confluence-page-markdown-save.md
git commit -m "docs: add epic 5 markdown save plan"
```

## Self-Review

- Spec coverage:
  - 페이지 1개를 Markdown 파일 1개로 저장: Task 3, Task 4, Task 5.
  - frontmatter에 Confluence 메타데이터 기록: Task 3.
  - 제목, 문단, 링크, 리스트, 코드 블록, 기본 표 변환: Task 2.
  - 파일명으로 쓸 수 없는 문자 정리: Task 3.
  - 동일 제목 충돌 처리: Task 3.
  - 변환 손실 가능성이 있는 macro 표시: Task 2.
- Placeholder scan:
  - 계획 본문에는 구현을 미루는 표시나 빈 단계가 없다.
- Type consistency:
  - `bodyStorageValue`, `MarkdownConversionWarning`, `PageMarkdownFile`, `ProjectStorageAdapter` 이름은 모든 task에서 동일하게 사용한다.
