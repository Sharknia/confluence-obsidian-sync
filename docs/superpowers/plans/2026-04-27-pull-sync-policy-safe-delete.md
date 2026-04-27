# Pull Sync Policy And Safe Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반복 Pull 때 기존 Markdown 파일을 안전하게 갱신하고, 사라진 Confluence 페이지는 삭제 대신 안전 삭제 폴더로 이동한다.

**Architecture:** Markdown 생성은 기존 `src/projects/pageMarkdown.ts`가 계속 담당하고, Pull 결과 적용 정책은 새 순수 모듈 `src/projects/pullSyncPolicy.ts`로 분리한다. `runPullTreeCommand`는 원격 페이지를 Markdown으로 변환한 뒤 로컬 프로젝트 파일 목록을 읽고, 정책 모듈이 산출한 write/move/skip 작업을 `projectStorage`의 저장 함수로 적용한다.

**Tech Stack:** TypeScript, Obsidian Vault Adapter, Node `crypto`, Vitest, ESLint, pnpm

---

## Scope

Epic 6의 완료 기준만 구현한다.

- 기존 파일을 갱신한다.
- 새 페이지를 추가한다.
- Confluence에서 사라진 페이지는 삭제하지 않고 안전 삭제 폴더로 이동한다.
- 로컬에서 수정된 파일을 무조건 덮어쓰지 않도록 정책을 적용한다.
- Pull 결과 요약을 Notice로 제공한다.

Sync Panel 상세 UI, diff UI, 사용자 확인 모달, Push 충돌 처리는 이후 Epic에서 다룬다. 이 계획에서는 Pull 명령 1회 실행 안에서 안전한 자동 정책과 요약 Notice까지만 구현한다.

## Policy

Markdown frontmatter에 `confluenceContentHash`를 추가한다. 값은 frontmatter를 제외한 Markdown 본문에 대한 `sha256:` prefix 해시다.

반복 Pull 정책:

- 새 원격 pageId에 해당하는 로컬 Markdown 파일이 없으면 새 파일을 쓴다.
- 같은 pageId의 로컬 Markdown 파일이 있고, 현재 로컬 본문 해시가 frontmatter의 `confluenceContentHash`와 같으면 로컬 수정이 없는 것으로 보고 원격 최신 내용으로 덮어쓴다.
- 같은 pageId의 로컬 Markdown 파일이 있고, 현재 로컬 본문 해시가 frontmatter의 `confluenceContentHash`와 다르면 로컬 수정이 있는 것으로 보고 덮어쓰지 않는다.
- 같은 pageId의 로컬 Markdown 파일이 있지만 `confluenceContentHash`가 없으면 legacy 파일로 보고, 새로 생성될 원격 Markdown 본문과 현재 로컬 Markdown 본문이 같을 때만 덮어써서 hash frontmatter를 보강한다. 본문이 다르면 덮어쓰지 않는다.
- 이전 Pull 산출물로 보이는 로컬 Markdown 파일의 pageId가 이번 Pull 결과에 없으면 삭제하지 않고 안전 삭제 폴더로 이동한다.
- 안전 삭제 폴더는 프로젝트 폴더 아래 `settings.safeDeleteFolder`를 사용한다. 기본값이면 `confluence/Root/.confluence-sync/trash/<timestamp>/...` 형태가 된다.
- 안전 삭제 대상이 로컬 수정된 파일이면 이동하지 않고 `skippedLocalChanges`에 포함한다.

## File Structure

- Modify: `src/projects/pageMarkdown.ts`
  - Markdown 본문 해시 생성, frontmatter의 `confluenceContentHash` 추가, 기존 Markdown에서 pageId/version/hash/body를 읽는 helper를 export한다.
- Modify: `src/projects/pageMarkdown.test.ts`
  - hash frontmatter, flat/legacy pageId 파싱, body hash 계산, legacy 파일 파싱을 검증한다.
- Create: `src/projects/pullSyncPolicy.ts`
  - 원격 Markdown 파일과 로컬 Markdown 파일 목록을 비교해 write/move/skip/summary 계획을 만든다.
- Create: `src/projects/pullSyncPolicy.test.ts`
  - 새 페이지 추가, 기존 파일 갱신, 로컬 수정 스킵, 사라진 페이지 안전 이동, 안전 삭제 충돌 suffix를 검증한다.
- Modify: `src/projects/projectStorage.ts`
  - storage adapter에 `list`와 `rename`을 추가하고, recursive Markdown 목록 조회와 Pull 작업 적용 함수를 제공한다.
- Modify: `src/projects/projectStorage.test.ts`
  - 재귀 목록 조회, 안전 이동 폴더 생성, write/move 적용 순서, storage 오류를 검증한다.
- Modify: `src/commands/pullTreeCommand.ts`
  - `writeMarkdownPages` 직접 호출 대신 Pull sync policy를 계획하고 적용한 뒤 요약 Notice를 표시한다.
- Modify: `src/commands/pullTreeCommand.test.ts`
  - 요약 Notice, 로컬 수정 스킵, 삭제 대신 안전 이동, 저장 실패 Notice를 검증한다.
- Modify: `src/main.ts`
  - Obsidian adapter의 `list`와 `rename`을 `ProjectStorageAdapter`에 연결한다.
- Modify: `docs/mvp-epics.md`
  - Epic 6 구현 계획 링크를 추가한다.

## Data Shape

```typescript
export interface ParsedPageMarkdownMetadata {
  pageId: string;
  versionNumber: number | null;
  contentHash: string | null;
  bodyMarkdown: string;
}

export interface LocalMarkdownPageFile {
  pageId: string;
  vaultPath: string;
  content: string;
  metadata: ParsedPageMarkdownMetadata;
  hasLocalChanges: boolean;
}

export interface PullSyncPlan {
  filesToWrite: PageMarkdownFileWriteOperation[];
  filesToMoveToSafeDelete: SafeDeleteMoveOperation[];
  skippedLocalChanges: LocalMarkdownPageFile[];
  unchangedFileCount: number;
}

export interface PageMarkdownFileWriteOperation extends PageMarkdownFile {
  operation: "create" | "update";
}

export interface PullSyncApplySuccess {
  ok: true;
  writtenFileCount: number;
  safeDeletedFileCount: number;
  skippedLocalChangeCount: number;
  unchangedFileCount: number;
}
```

## Pseudocode

```text
runPullTreeCommand:
  validate settings and current project
  fetch Confluence tree
  build remote Markdown files
  list local Markdown files under current project root
  parse local Confluence page metadata
  plan = createPullSyncPlan(remote files, local files, project root, safe delete root, now)
  applyPullSyncPlan(storage, plan)
  show summary:
    Pull 완료: 추가 A개, 갱신 B개, 안전 삭제 C개, 로컬 수정 스킵 D개, 변경 없음 E개

createPullSyncPlan:
  remoteByPageId = map remote files by pageId
  localByPageId = map local markdown files with parseable confluencePageId
  for each remote file:
    existing = localByPageId[remote.pageId]
    if no existing:
      write remote file
    else if cannot replace existing safely:
      skip existing
    else if existing.content == remote.content:
      unchanged
    else:
      write remote file at existing.vaultPath
  for each local file:
    if local.pageId not in remoteByPageId and not local.hasLocalChanges:
      move to safe delete timestamp folder
    if local.pageId not in remoteByPageId and local.hasLocalChanges:
      skip existing
```

## Task 1: Markdown metadata hash와 parser 추가

**Files:**
- Modify: `src/projects/pageMarkdown.ts`
- Modify: `src/projects/pageMarkdown.test.ts`

- [ ] **Step 1: Write failing tests for hash frontmatter and parser**

Add these imports in `src/projects/pageMarkdown.test.ts`:

```typescript
import {
  buildPageMarkdownFiles,
  calculateMarkdownBodyHash,
  createSafeMarkdownFileName,
  parsePageMarkdownMetadata,
} from "./pageMarkdown";
```

Add tests inside `describe("buildPageMarkdownFiles", () => { ... })`:

```typescript
it("stores a stable content hash for the generated markdown body", async () => {
  const rootPage = createPage({ pageId: "100", title: "Root", bodyStorageValue: "<p>Hello</p>" });
  const root: ConfluencePageTreeNode = { ...rootPage, children: [] };

  const files = await buildPageMarkdownFiles({
    projectRootPath: "confluence/Root",
    root,
    pages: [rootPage],
    pathExists: () => Promise.resolve(false),
  });

  expect(files[0]?.content).toContain(`confluenceContentHash: "${calculateMarkdownBodyHash("Hello\\n")}"`);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/projects/pageMarkdown.test.ts
```

Expected: FAIL because `calculateMarkdownBodyHash`, `parsePageMarkdownMetadata`, and `confluenceContentHash` do not exist.

- [ ] **Step 3: Implement hash and metadata parser**

Modify `src/projects/pageMarkdown.ts`:

```typescript
import { createHash } from "crypto";
```

Add these exports near the existing interfaces:

```typescript
export interface ParsedPageMarkdownMetadata {
  pageId: string;
  versionNumber: number | null;
  contentHash: string | null;
  bodyMarkdown: string;
}

const FRONTMATTER_PATTERN = /^\s*---\n([\s\S]*?)\n---\n?/u;

export function calculateMarkdownBodyHash(markdownBody: string): string {
  return `sha256:${createHash("sha256").update(markdownBody, "utf8").digest("hex")}`;
}

export function parsePageMarkdownMetadata(markdown: string): ParsedPageMarkdownMetadata | null {
  const frontmatterMatch = markdown.match(FRONTMATTER_PATTERN);

  if (frontmatterMatch === null) {
    return null;
  }

  const frontmatter = frontmatterMatch[1] ?? "";
  const pageId =
    readQuotedFrontmatterValue(frontmatter, "confluencePageId") ??
    readQuotedFrontmatterValue(frontmatter, "pageId") ??
    readNestedConfluencePageId(frontmatter);

  if (pageId === null) {
    return null;
  }

  return {
    pageId,
    versionNumber: readNumericFrontmatterValue(frontmatter, "confluenceVersion"),
    contentHash: readQuotedFrontmatterValue(frontmatter, "confluenceContentHash"),
    bodyMarkdown: markdown.slice(frontmatterMatch[0].length),
  };
}

function readQuotedFrontmatterValue(frontmatter: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = frontmatter.match(new RegExp(`^\\s*${escapedKey}:\\s*"([^"]*)"\\s*$`, "mu"));

  return match?.[1] ?? null;
}

function readNumericFrontmatterValue(frontmatter: string, key: string): number | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = frontmatter.match(new RegExp(`^\\s*${escapedKey}:\\s*(\\d+)\\s*$`, "mu"));

  if (match?.[1] === undefined) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function readNestedConfluencePageId(frontmatter: string): string | null {
  const match = frontmatter.match(/^confluence:\s*\n(?:\s+[A-Za-z0-9_-]+:\s*.*\n)*?\s+pageId:\s*"([^"]*)"\s*$/mu);

  return match?.[1] ?? null;
}
```

Change the file creation loop in `buildPageMarkdownFiles`:

```typescript
const markdownBody = `${markdownConversion.markdown}\n`;

files.push({
  pageId: page.pageId,
  title: page.title,
  vaultPath,
  warnings: markdownConversion.warnings,
  content: `${createFrontmatter(page, markdownBody)}\n\n${markdownBody}`,
});
```

Replace `createFrontmatter`:

```typescript
function createFrontmatter(page: ConfluencePageTreePage, markdownBody: string): string {
  return `---
confluencePageId: ${JSON.stringify(page.pageId)}
confluenceTitle: ${JSON.stringify(page.title)}
confluenceVersion: ${page.versionNumber}
confluenceSourceUrl: ${JSON.stringify(page.sourceUrl)}
confluenceParentId: ${page.parentId === null ? "null" : JSON.stringify(page.parentId)}
confluenceContentHash: ${JSON.stringify(calculateMarkdownBodyHash(markdownBody))}
---`;
}
```

Change `canUseCandidatePath` to use the parser:

```typescript
try {
  return parsePageMarkdownMetadata(await readExistingFile(candidatePath))?.pageId === pageId;
} catch {
  return false;
}
```

Delete the old private `extractConfluencePageIdFromMarkdown` function after replacing its only use.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/projects/pageMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projects/pageMarkdown.ts src/projects/pageMarkdown.test.ts
git commit -m "feat: track pulled markdown content hashes"
```

## Task 2: Pull sync policy 순수 로직 추가

**Files:**
- Create: `src/projects/pullSyncPolicy.ts`
- Create: `src/projects/pullSyncPolicy.test.ts`

- [ ] **Step 1: Write failing tests for sync planning**

Create `src/projects/pullSyncPolicy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { PageMarkdownFile } from "./pageMarkdown";
import { calculateMarkdownBodyHash } from "./pageMarkdown";
import {
  createPullSyncPlan,
  type LocalMarkdownFileSnapshot,
} from "./pullSyncPolicy";

function createRemoteFile(overrides: Partial<PageMarkdownFile> & { pageId: string; vaultPath: string; body: string }): PageMarkdownFile {
  const contentHash = calculateMarkdownBodyHash(overrides.body);

  return {
    pageId: overrides.pageId,
    title: overrides.title ?? overrides.pageId,
    vaultPath: overrides.vaultPath,
    warnings: [],
    content: `---
confluencePageId: "${overrides.pageId}"
confluenceVersion: 2
confluenceContentHash: "${contentHash}"
---

${overrides.body}`,
  };
}

function createLocalFile(path: string, pageId: string, body: string, hashBody = body): LocalMarkdownFileSnapshot {
  return {
    vaultPath: path,
    content: `---
confluencePageId: "${pageId}"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(hashBody)}"
---

${body}`,
  };
}

describe("createPullSyncPlan", () => {
  it("writes new remote pages when no local page exists", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote\n" });

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, operation: "create" }]);
    expect(plan.filesToMoveToSafeDelete).toEqual([]);
    expect(plan.skippedLocalChanges).toEqual([]);
    expect(plan.unchangedFileCount).toBe(0);
  });

  it("updates the existing path for an unchanged local page", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/New Root.md", body: "Remote v2\n" });
    const localFile = createLocalFile("confluence/Root/Old Root.md", "100", "Remote v1\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, vaultPath: "confluence/Root/Old Root.md", operation: "update" }]);
    expect(plan.unchangedFileCount).toBe(0);
  });

  it("skips an existing page when the local body changed after the last pull", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote v2\n" });
    const localFile = createLocalFile("confluence/Root/Root.md", "100", "Local draft\n", "Remote v1\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([]);
    expect(plan.skippedLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("moves disappeared remote pages to the safe delete folder", () => {
    const localFile = createLocalFile("confluence/Root/Old/Removed.md", "999", "Old body\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [localFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([
      {
        fromPath: "confluence/Root/Old/Removed.md",
        toPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z/Old/Removed.md",
      },
    ]);
  });

  it("moves disappeared legacy files without a content hash to the safe delete folder", () => {
    const localFile: LocalMarkdownFileSnapshot = {
      vaultPath: "confluence/Root/Legacy Removed.md",
      content: `---
confluence:
  pageId: "999"
---

Legacy body
`,
    };

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [localFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([
      {
        fromPath: "confluence/Root/Legacy Removed.md",
        toPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z/Legacy Removed.md",
      },
    ]);
    expect(plan.skippedLocalChanges).toEqual([]);
  });

  it("does not move disappeared pages that have local edits", () => {
    const localFile = createLocalFile("confluence/Root/Removed.md", "999", "Local draft\n", "Old body\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [localFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([]);
    expect(plan.skippedLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Removed.md"]);
  });

  it("updates legacy files without a hash when their markdown body matches the remote body", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Same body\n" });
    const localFile: LocalMarkdownFileSnapshot = {
      vaultPath: "confluence/Root/Root.md",
      content: `---
confluencePageId: "100"
confluenceVersion: 1
---

Same body
`,
    };

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, vaultPath: "confluence/Root/Root.md", operation: "update" }]);
    expect(plan.skippedLocalChanges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/projects/pullSyncPolicy.test.ts
```

Expected: FAIL because `src/projects/pullSyncPolicy.ts` does not exist.

- [ ] **Step 3: Implement sync planning**

Create `src/projects/pullSyncPolicy.ts`:

```typescript
import {
  calculateMarkdownBodyHash,
  parsePageMarkdownMetadata,
  type PageMarkdownFile,
  type ParsedPageMarkdownMetadata,
} from "./pageMarkdown";

export interface LocalMarkdownFileSnapshot {
  vaultPath: string;
  content: string;
}

export interface LocalMarkdownPageFile extends LocalMarkdownFileSnapshot {
  pageId: string;
  metadata: ParsedPageMarkdownMetadata;
  hasLocalChanges: boolean;
}

export interface PageMarkdownFileWriteOperation extends PageMarkdownFile {
  operation: "create" | "update";
}

export interface SafeDeleteMoveOperation {
  fromPath: string;
  toPath: string;
}

export interface PullSyncPlan {
  filesToWrite: PageMarkdownFileWriteOperation[];
  filesToMoveToSafeDelete: SafeDeleteMoveOperation[];
  skippedLocalChanges: LocalMarkdownPageFile[];
  unchangedFileCount: number;
}

export interface CreatePullSyncPlanInput {
  projectRootPath: string;
  safeDeleteRootPath: string;
  remoteFiles: PageMarkdownFile[];
  localFiles: LocalMarkdownFileSnapshot[];
}

export function createPullSyncPlan(input: CreatePullSyncPlanInput): PullSyncPlan {
  const localPageFiles = input.localFiles
    .map(toLocalMarkdownPageFile)
    .filter((file): file is LocalMarkdownPageFile => file !== null)
    .filter((file) => !isInsideSafeDeleteFolder(file.vaultPath, input.safeDeleteRootPath));
  const localFilesByPageId = new Map(localPageFiles.map((file) => [file.pageId, file]));
  const remotePageIds = new Set(input.remoteFiles.map((file) => file.pageId));
  const filesToWrite: PageMarkdownFileWriteOperation[] = [];
  const filesToMoveToSafeDelete: SafeDeleteMoveOperation[] = [];
  const skippedLocalChanges: LocalMarkdownPageFile[] = [];
  let unchangedFileCount = 0;

  for (const remoteFile of input.remoteFiles) {
    const localFile = localFilesByPageId.get(remoteFile.pageId);

    if (localFile === undefined) {
      filesToWrite.push({ ...remoteFile, operation: "create" });
      continue;
    }

    if (!canReplaceLocalFile(localFile, remoteFile)) {
      skippedLocalChanges.push(localFile);
      continue;
    }

    if (localFile.content === remoteFile.content) {
      unchangedFileCount += 1;
      continue;
    }

    filesToWrite.push({ ...remoteFile, vaultPath: localFile.vaultPath, operation: "update" });
  }

  for (const localFile of localPageFiles) {
    if (remotePageIds.has(localFile.pageId)) {
      continue;
    }

    if (localFile.hasLocalChanges) {
      skippedLocalChanges.push(localFile);
      continue;
    }

    filesToMoveToSafeDelete.push({
      fromPath: localFile.vaultPath,
      toPath: buildSafeDeletePath(input.projectRootPath, input.safeDeleteRootPath, localFile.vaultPath),
    });
  }

  return {
    filesToWrite,
    filesToMoveToSafeDelete,
    skippedLocalChanges,
    unchangedFileCount,
  };
}

function toLocalMarkdownPageFile(file: LocalMarkdownFileSnapshot): LocalMarkdownPageFile | null {
  const metadata = parsePageMarkdownMetadata(file.content);

  if (metadata === null) {
    return null;
  }

  return {
    ...file,
    pageId: metadata.pageId,
    metadata,
    hasLocalChanges: hasLocalMarkdownBodyChanged(metadata),
  };
}

function hasLocalMarkdownBodyChanged(metadata: ParsedPageMarkdownMetadata): boolean {
  if (metadata.contentHash === null) {
    return false;
  }

  return calculateMarkdownBodyHash(metadata.bodyMarkdown) !== metadata.contentHash;
}

function canReplaceLocalFile(localFile: LocalMarkdownPageFile, remoteFile: PageMarkdownFile): boolean {
  if (localFile.metadata.contentHash !== null) {
    return !localFile.hasLocalChanges;
  }

  const remoteMetadata = parsePageMarkdownMetadata(remoteFile.content);

  if (remoteMetadata === null) {
    return false;
  }

  // hash가 없는 Epic 5 산출물은 본문이 동일할 때만 hash 추가 갱신을 허용한다.
  return localFile.metadata.bodyMarkdown === remoteMetadata.bodyMarkdown;
}

function buildSafeDeletePath(projectRootPath: string, safeDeleteRootPath: string, originalPath: string): string {
  const relativePath = removePathPrefix(originalPath, projectRootPath);

  return joinVaultPath(safeDeleteRootPath, relativePath);
}

function removePathPrefix(path: string, prefix: string): string {
  if (path === prefix) {
    return "";
  }

  const normalizedPrefix = `${prefix.replace(/\/+$/u, "")}/`;

  return path.startsWith(normalizedPrefix) ? path.slice(normalizedPrefix.length) : path.split("/").pop() ?? path;
}

function isInsideSafeDeleteFolder(path: string, safeDeleteRootPath: string): boolean {
  const normalizedSafeDeleteRootPath = safeDeleteRootPath.replace(/\/+$/u, "");

  return path === normalizedSafeDeleteRootPath || path.startsWith(`${normalizedSafeDeleteRootPath}/`);
}

function joinVaultPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/projects/pullSyncPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projects/pullSyncPolicy.ts src/projects/pullSyncPolicy.test.ts
git commit -m "feat: plan safe pull sync operations"
```

## Task 3: Storage adapter에 list/rename과 Pull 적용 함수 추가

**Files:**
- Modify: `src/projects/projectStorage.ts`
- Modify: `src/projects/projectStorage.test.ts`

- [ ] **Step 1: Write failing tests for recursive list and apply**

Add imports in `src/projects/projectStorage.test.ts`:

```typescript
import {
  applyPullSyncPlan,
  listProjectMarkdownFiles,
  writeMarkdownPages,
  writeProjectManifest,
  type ProjectStorageAdapter,
} from "./projectStorage";
import type { PullSyncPlan } from "./pullSyncPolicy";
```

Extend `ProjectStorageAdapter` mock:

```typescript
interface StorageMockOptions {
  existingPaths?: Set<string>;
  existingFiles?: Map<string, string>;
  listedFolders?: Map<string, { files: string[]; folders: string[] }>;
  failOnListPath?: string;
  failOnMkdirPath?: string;
  failOnWritePath?: string;
  failOnRenamePath?: string;
  onExists?: (path: string, callCount: number) => boolean;
}
```

Add `list` and `rename` to the mock:

```typescript
list(path: string): Promise<{ files: string[]; folders: string[] }> {
  calls.push(`list:${path}`);

  if (options.failOnListPath === path) {
    return Promise.reject(new Error(`list failed: ${path}`));
  }

  return Promise.resolve(options.listedFolders?.get(path) ?? { files: [], folders: [] });
},
rename(fromPath: string, toPath: string): Promise<void> {
  calls.push(`rename:${fromPath}:${toPath}`);

  if (options.failOnRenamePath === fromPath) {
    return Promise.reject(new Error(`rename failed: ${fromPath}`));
  }

  const content = existingFiles.get(fromPath);
  existingPaths.delete(fromPath);
  existingPaths.add(toPath);

  if (content !== undefined) {
    existingFiles.delete(fromPath);
    existingFiles.set(toPath, content);
  }

  return Promise.resolve();
},
```

Add tests after `describe("writeMarkdownPages", ...)`:

```typescript
describe("listProjectMarkdownFiles", () => {
  it("recursively lists markdown files and skips the safe delete folder", async () => {
    const { storage } = createStorageMock({
      existingFiles: new Map([
        ["confluence/Root/Root.md", "root"],
        ["confluence/Root/Folder/Child.md", "child"],
        ["confluence/Root/.confluence-sync/trash/old.md", "old"],
      ]),
      listedFolders: new Map([
        [
          "confluence/Root",
          {
            files: ["confluence/Root/Root.md", "confluence/Root/notes.txt"],
            folders: ["confluence/Root/Folder", "confluence/Root/.confluence-sync"],
          },
        ],
        [
          "confluence/Root/Folder",
          {
            files: ["confluence/Root/Folder/Child.md"],
            folders: [],
          },
        ],
        [
          "confluence/Root/.confluence-sync",
          {
            files: [],
            folders: ["confluence/Root/.confluence-sync/trash"],
          },
        ],
      ]),
    });

    const result = await listProjectMarkdownFiles(
      storage,
      "confluence/Root",
      "confluence/Root/.confluence-sync/trash",
    );

    expect(result).toEqual({
      ok: true,
      files: [
        { vaultPath: "confluence/Root/Root.md", content: "root" },
        { vaultPath: "confluence/Root/Folder/Child.md", content: "child" },
      ],
    });
  });

  it("returns storage-error when a folder cannot be listed", async () => {
    const { storage } = createStorageMock({
      failOnListPath: "confluence/Root",
    });

    await expect(
      listProjectMarkdownFiles(storage, "confluence/Root", "confluence/Root/.confluence-sync/trash")
    ).resolves.toEqual({
      ok: false,
      reason: "storage-error",
      message: "로컬 Markdown 파일 목록을 읽을 수 없습니다.",
    });
  });
});

describe("applyPullSyncPlan", () => {
  it("writes files and moves safe delete files after creating parent folders", async () => {
    const plan: PullSyncPlan = {
      filesToWrite: [
        {
          pageId: "100",
          title: "Root",
          vaultPath: "confluence/Root/Root.md",
          content: "# Root\n",
          warnings: [],
          operation: "update",
        },
      ],
      filesToMoveToSafeDelete: [
        {
          fromPath: "confluence/Root/Old/Removed.md",
          toPath: "confluence/Root/.confluence-sync/trash/2026/Old/Removed.md",
        },
      ],
      skippedLocalChanges: [],
      unchangedFileCount: 2,
    };
    const { calls, storage } = createStorageMock();

    const result = await applyPullSyncPlan(storage, plan);

    expect(result).toEqual({
      ok: true,
      writtenFileCount: 1,
      safeDeletedFileCount: 1,
      skippedLocalChangeCount: 0,
      unchangedFileCount: 2,
    });
    expect(calls).toContain("write:confluence/Root/Root.md:# Root\n");
    expect(calls).toContain("rename:confluence/Root/Old/Removed.md:confluence/Root/.confluence-sync/trash/2026/Old/Removed.md");
  });

  it("returns storage-error when a safe delete move fails", async () => {
    const plan: PullSyncPlan = {
      filesToWrite: [],
      filesToMoveToSafeDelete: [
        {
          fromPath: "confluence/Root/Removed.md",
          toPath: "confluence/Root/.confluence-sync/trash/2026/Removed.md",
        },
      ],
      skippedLocalChanges: [],
      unchangedFileCount: 0,
    };
    const { storage } = createStorageMock({
      failOnRenamePath: "confluence/Root/Removed.md",
    });

    await expect(applyPullSyncPlan(storage, plan)).resolves.toEqual({
      ok: false,
      reason: "storage-error",
      message: "Pull 결과를 로컬 파일에 적용할 수 없습니다.",
    });
  });

  it("adds a numeric suffix when a safe delete destination already exists", async () => {
    const plan: PullSyncPlan = {
      filesToWrite: [],
      filesToMoveToSafeDelete: [
        {
          fromPath: "confluence/Root/Removed.md",
          toPath: "confluence/Root/.confluence-sync/trash/2026/Removed.md",
        },
      ],
      skippedLocalChanges: [],
      unchangedFileCount: 0,
    };
    const { calls, storage } = createStorageMock({
      existingPaths: new Set(["confluence/Root/.confluence-sync/trash/2026/Removed.md"]),
    });

    const result = await applyPullSyncPlan(storage, plan);

    expect(result).toEqual({
      ok: true,
      writtenFileCount: 0,
      safeDeletedFileCount: 1,
      skippedLocalChangeCount: 0,
      unchangedFileCount: 0,
    });
    expect(calls).toContain(
      "rename:confluence/Root/Removed.md:confluence/Root/.confluence-sync/trash/2026/Removed (1).md"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/projects/projectStorage.test.ts
```

Expected: FAIL because adapter `list`/`rename`, `listProjectMarkdownFiles`, and `applyPullSyncPlan` do not exist.

- [ ] **Step 3: Implement storage operations**

Modify `src/projects/projectStorage.ts`:

```typescript
import type { PageMarkdownFile } from "./pageMarkdown";
import type { PullSyncPlan } from "./pullSyncPolicy";
```

Extend `ProjectStorageAdapter`:

```typescript
export interface ProjectStorageAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  rename(fromPath: string, toPath: string): Promise<void>;
}
```

Add result types:

```typescript
export interface PullSyncApplySuccess {
  ok: true;
  writtenFileCount: number;
  safeDeletedFileCount: number;
  skippedLocalChangeCount: number;
  unchangedFileCount: number;
}

export interface PullSyncApplyFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type PullSyncApplyResult = PullSyncApplySuccess | PullSyncApplyFailure;

export interface ListProjectMarkdownFilesSuccess {
  ok: true;
  files: Array<{ vaultPath: string; content: string }>;
}

export interface ListProjectMarkdownFilesFailure {
  ok: false;
  reason: "storage-error";
  message: string;
}

export type ListProjectMarkdownFilesResult = ListProjectMarkdownFilesSuccess | ListProjectMarkdownFilesFailure;
```

Add functions:

```typescript
export async function listProjectMarkdownFiles(
  storage: ProjectStorageAdapter,
  projectRootPath: string,
  safeDeleteRootPath: string
): Promise<ListProjectMarkdownFilesResult> {
  const markdownFiles: Array<{ vaultPath: string; content: string }> = [];

  async function visitFolder(folderPath: string): Promise<void> {
    if (isSameOrChildPath(folderPath, safeDeleteRootPath)) {
      return;
    }

    const listedFiles = await storage.list(folderPath);

    for (const filePath of listedFiles.files) {
      if (!filePath.endsWith(".md") || isSameOrChildPath(filePath, safeDeleteRootPath)) {
        continue;
      }

      markdownFiles.push({
        vaultPath: filePath,
        content: await storage.read(filePath),
      });
    }

    for (const childFolderPath of listedFiles.folders) {
      await visitFolder(childFolderPath);
    }
  }

  try {
    await visitFolder(projectRootPath);

    return {
      ok: true,
      files: markdownFiles,
    };
  } catch {
    return {
      ok: false,
      reason: "storage-error",
      message: "로컬 Markdown 파일 목록을 읽을 수 없습니다.",
    };
  }
}

export async function applyPullSyncPlan(
  storage: ProjectStorageAdapter,
  plan: PullSyncPlan
): Promise<PullSyncApplyResult> {
  try {
    const writeResult = await writeMarkdownPages(storage, plan.filesToWrite);

    if (!writeResult.ok) {
      return {
        ok: false,
        reason: "storage-error",
        message: "Pull 결과를 로컬 파일에 적용할 수 없습니다.",
      };
    }

    for (const moveOperation of plan.filesToMoveToSafeDelete) {
      const availableToPath = await createAvailableMoveDestinationPath(storage, moveOperation.toPath);

      for (const parentFolderPath of buildParentFolderPaths(availableToPath)) {
        await ensureFolderExists(storage, parentFolderPath);
      }

      await storage.rename(moveOperation.fromPath, availableToPath);
    }

    return {
      ok: true,
      writtenFileCount: plan.filesToWrite.length,
      safeDeletedFileCount: plan.filesToMoveToSafeDelete.length,
      skippedLocalChangeCount: plan.skippedLocalChanges.length,
      unchangedFileCount: plan.unchangedFileCount,
    };
  } catch {
    return {
      ok: false,
      reason: "storage-error",
      message: "Pull 결과를 로컬 파일에 적용할 수 없습니다.",
    };
  }
}

function isSameOrChildPath(path: string, parentPath: string): boolean {
  const normalizedPath = path.replace(/\/+$/u, "");
  const normalizedParentPath = parentPath.replace(/\/+$/u, "");

  return normalizedPath === normalizedParentPath || normalizedPath.startsWith(`${normalizedParentPath}/`);
}

async function createAvailableMoveDestinationPath(storage: ProjectStorageAdapter, requestedPath: string): Promise<string> {
  if (!(await storage.exists(requestedPath))) {
    return requestedPath;
  }

  const extensionIndex = requestedPath.toLocaleLowerCase("en-US").endsWith(".md") ? requestedPath.length - 3 : requestedPath.length;
  const basePath = requestedPath.slice(0, extensionIndex);
  const extension = requestedPath.slice(extensionIndex);
  let collisionIndex = 1;

  while (true) {
    const candidatePath = `${basePath} (${collisionIndex})${extension}`;

    if (!(await storage.exists(candidatePath))) {
      return candidatePath;
    }

    collisionIndex += 1;
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
git commit -m "feat: apply pull sync file operations"
```

## Task 4: Pull Tree 명령에 sync policy 연결

**Files:**
- Modify: `src/commands/pullTreeCommand.ts`
- Modify: `src/commands/pullTreeCommand.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing command tests**

Add this import in `src/commands/pullTreeCommand.test.ts`:

```typescript
import { calculateMarkdownBodyHash } from "../projects/pageMarkdown";
```

Update `createStorageMock` in `src/commands/pullTreeCommand.test.ts` so it supports `list` and `rename`:

```typescript
interface StorageMock extends ProjectStorageAdapter {
  writtenFiles: Array<{ path: string; data: string }>;
  movedFiles: Array<{ fromPath: string; toPath: string }>;
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
    ...overrides,
  };
}
```

Replace the main success Notice expectation:

```typescript
expect(notices).toEqual(["Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개, 조회 실패 1개"]);
```

Add tests:

```typescript
it("기존 파일이 로컬 수정되지 않았으면 같은 경로를 갱신한다", async () => {
  const notices: string[] = [];
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

${existingBody}`),
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
      childPosition: 0,
    };

    return Promise.resolve({ ok: true, root: { ...rootPage, children: [] }, pages: [rootPage], errors: [] });
  };

  await runPullTreeCommand({
    settings: createSettings(),
    storage,
    fetchTree,
    showNotice: (message) => notices.push(message),
  });

  expect(storage.writtenFiles.map((file) => file.path)).toEqual(["confluence/Root/Old Root.md"]);
  expect(notices).toEqual(["Pull 완료: 추가 0개, 갱신 1개, 안전 삭제 0개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
});

it("로컬 수정된 기존 파일은 덮어쓰지 않는다", async () => {
  const notices: string[] = [];
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
`),
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
      childPosition: 0,
    };

    return Promise.resolve({ ok: true, root: { ...rootPage, children: [] }, pages: [rootPage], errors: [] });
  };

  await runPullTreeCommand({
    settings: createSettings(),
    storage,
    fetchTree,
    showNotice: (message) => notices.push(message),
  });

  expect(storage.writtenFiles).toEqual([]);
  expect(notices).toEqual(["Pull 완료: 추가 0개, 갱신 0개, 안전 삭제 0개, 로컬 수정 스킵 1개, 변경 없음 0개"]);
});

it("Confluence에서 사라진 파일은 안전 삭제 폴더로 이동한다", async () => {
  const notices: string[] = [];
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

${existingBody}`),
  });
  const fetchTree: PullTreeFetcher = () =>
    Promise.resolve({
      ok: true,
      root: {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 1,
        bodyStorageValue: "<p>Root</p>",
        sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
        depth: 0,
        childPosition: 0,
        children: [],
      },
      pages: [
        {
          pageId: "100",
          title: "Root",
          parentId: null,
          versionNumber: 1,
          bodyStorageValue: "<p>Root</p>",
          sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
          depth: 0,
          childPosition: 0,
        },
      ],
      errors: [],
    });

  await runPullTreeCommand({
    settings: createSettings(),
    storage,
    fetchTree,
    showNotice: (message) => notices.push(message),
  });

  expect(storage.movedFiles[0]?.fromPath).toBe("confluence/Root/Removed.md");
  expect(storage.movedFiles[0]?.toPath).toContain("confluence/Root/.confluence-sync/trash/");
  expect(storage.movedFiles[0]?.toPath).toContain("/Removed.md");
  expect(notices).toEqual(["Pull 완료: 추가 1개, 갱신 0개, 안전 삭제 1개, 로컬 수정 스킵 0개, 변경 없음 0개"]);
});
```

- [ ] **Step 2: Run command tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/commands/pullTreeCommand.test.ts
```

Expected: FAIL because `runPullTreeCommand` still writes all Markdown files directly and `main.ts` adapter lacks `list`/`rename`.

- [ ] **Step 3: Implement command integration**

Modify imports in `src/commands/pullTreeCommand.ts`:

```typescript
import { createPullSyncPlan } from "../projects/pullSyncPolicy";
import {
  applyPullSyncPlan,
  listProjectMarkdownFiles,
  type PullSyncApplyResult,
  type ProjectStorageAdapter,
} from "../projects/projectStorage";
```

Replace the `writeMarkdownPages` flow inside success branch:

```typescript
let writeResult: PullSyncApplyResult;

const safeDeleteRootPath = buildSafeDeleteRootPath(
  currentProject.localFolderPath,
  settings.safeDeleteFolder,
  new Date()
);

const localMarkdownFiles = await listProjectMarkdownFiles(
  storage,
  currentProject.localFolderPath,
  removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath)
);

if (!localMarkdownFiles.ok) {
  showNotice(localMarkdownFiles.message);
  return;
}

const syncPlan = createPullSyncPlan({
  projectRootPath: currentProject.localFolderPath,
  safeDeleteRootPath,
  remoteFiles: markdownFiles,
  localFiles: localMarkdownFiles.files,
});
writeResult = await applyPullSyncPlan(storage, syncPlan);
```

Replace failure Notice:

```typescript
if (!writeResult.ok) {
  showNotice("Pull 결과를 로컬 파일에 적용할 수 없습니다.");
  return;
}
```

Replace success Notice:

```typescript
const createCount = syncPlan.filesToWrite.filter((file) => file.operation === "create").length;
const updateCount = syncPlan.filesToWrite.filter((file) => file.operation === "update").length;
const conversionWarningCount = markdownFiles.reduce((count, file) => count + file.warnings.length, 0);

showNotice(
  `Pull 완료: 추가 ${createCount}개, 갱신 ${updateCount}개, 안전 삭제 ${writeResult.safeDeletedFileCount}개, 로컬 수정 스킵 ${writeResult.skippedLocalChangeCount}개, 변경 없음 ${writeResult.unchangedFileCount}개${buildSuccessNoticeSuffix(
    result.errors.length,
    conversionWarningCount
  )}`
);
```

Add helpers to `src/commands/pullTreeCommand.ts`:

```typescript
function buildSafeDeleteRootPath(projectRootPath: string, safeDeleteFolder: string, now: Date): string {
  return joinVaultPath(projectRootPath, normalizeSafeDeleteFolder(safeDeleteFolder), createTimestampFolderName(now));
}

function removeTimestampSegmentFromSafeDeletePath(safeDeleteRootPath: string): string {
  const pathSegments = safeDeleteRootPath.split("/");

  return pathSegments.slice(0, -1).join("/");
}

function normalizeSafeDeleteFolder(safeDeleteFolder: string): string {
  const normalizedFolder = safeDeleteFolder.trim().replace(/^\/+|\/+$/gu, "");

  return normalizedFolder.length > 0 ? normalizedFolder : ".confluence-sync/trash";
}

function createTimestampFolderName(now: Date): string {
  return now.toISOString().replace(/[:.]/gu, "-");
}

function joinVaultPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}
```

Modify `src/main.ts` adapter:

```typescript
function createVaultStorageAdapter(plugin: ConfluenceObsidianSyncPlugin): ProjectStorageAdapter {
  return {
    exists: (path) => plugin.app.vault.adapter.exists(path),
    mkdir: (path) => plugin.app.vault.adapter.mkdir(path),
    read: (path) => plugin.app.vault.adapter.read(path),
    write: (path, data) => plugin.app.vault.adapter.write(path, data),
    list: (path) => plugin.app.vault.adapter.list(path),
    rename: (fromPath, toPath) => plugin.app.vault.adapter.rename(fromPath, toPath),
  };
}
```

- [ ] **Step 4: Run command tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/commands/pullTreeCommand.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/pullTreeCommand.ts src/commands/pullTreeCommand.test.ts src/main.ts
git commit -m "feat: apply safe pull sync policy"
```

## Task 5: Full verification and vault preparation

**Files:**
- Modify: `docs/mvp-epics.md`

- [ ] **Step 1: Link the Epic 6 plan**

Add under `## Epic 6. Pull 동기화 정책과 안전 삭제`:

```markdown
### 구현 계획

- [Pull Sync Policy And Safe Delete Implementation Plan](superpowers/plans/2026-04-27-pull-sync-policy-safe-delete.md)
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm run verify
```

Expected: PASS for lint, tests, and build.

- [ ] **Step 3: Prepare current vault**

Run:

```bash
pnpm run prepare:current-vault
```

Expected: PASS and plugin files copied into the current vault.

- [ ] **Step 4: Confirm built plugin contains the new Pull summary**

Run:

```bash
rg "Pull 완료: 추가" .obsidian/plugins/confluence-obsidian-sync/main.js
```

Expected: output includes the new summary string.

- [ ] **Step 5: Confirm generated plugin output is current**

Run:

```bash
cmp dist/main.js .obsidian/plugins/confluence-obsidian-sync/main.js
```

Expected: exit code 0 with no output.

- [ ] **Step 6: Commit docs link**

```bash
git add docs/mvp-epics.md
git commit -m "docs: link pull sync policy plan"
```

## Self-Review

- Spec coverage:
  - 기존 파일 갱신: Task 2 policy와 Task 4 command integration에서 `operation: "update"`로 처리한다.
  - 새 페이지 추가: Task 2 policy에서 로컬 pageId가 없을 때 `operation: "create"`로 처리한다.
  - 사라진 페이지 안전 삭제: Task 2 policy와 Task 3 storage 적용에서 `rename`으로 안전 삭제 폴더 이동을 처리한다.
  - 로컬 수정 보호: Task 1 hash와 Task 2 `hasLocalChanges`로 덮어쓰기를 막는다.
  - legacy 호환: Task 1 parser가 flat `confluencePageId`, flat `pageId`, nested `confluence.pageId`를 모두 읽고, hash 없는 기존 Pull 산출물도 사라진 페이지 안전 삭제 대상으로 처리한다.
  - Pull 결과 요약: Task 4 Notice 문자열로 추가/갱신/안전 삭제/스킵/변경 없음/조회 실패/변환 경고를 제공한다.
- Placeholder scan:
  - 계획 안에 미정 구현, 빈 함수, 나중 처리 항목이 없다.
- Type consistency:
  - `PageMarkdownFileWriteOperation`, `PullSyncPlan`, `LocalMarkdownFileSnapshot`, `PullSyncApplyResult` 이름이 테스트와 구현 단계에서 일치한다.
