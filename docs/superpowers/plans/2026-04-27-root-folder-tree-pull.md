# Root Folder Tree Pull Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rootContentType: "folder"` 프로젝트에서 Confluence folder descendants API를 사용해 하위 페이지 트리를 내려받고, 페이지 메타데이터와 부분 실패 오류 목록을 반환한다.

**Architecture:** 기존 page root Pull API와 타입 계약은 유지하고, folder root Pull 전용 트리 결과를 추가한다. Folder descendants 응답은 page 외 folder도 반환하므로 folder root 흐름에서만 folder를 구조 보존용 노드로 유지하고, page만 상세 조회해 `title`, `pageId`, `parentId`, `versionNumber`, `sourceUrl`을 채운다. Obsidian 명령은 현재 프로젝트의 `rootContentType/rootContentId`를 전달하고, dispatcher 함수가 page root는 기존 `fetchConfluencePageTree`, folder root는 새 folder tree fetcher로 라우팅한다.

**Tech Stack:** TypeScript, Atlassian Confluence Cloud REST API v2, Obsidian `requestUrl` transport, Vitest, ESLint, pnpm

---

## Scope

Epic 4 확장의 완료 기준만 구현한다.

- `rootContentType === "folder"` 프로젝트 인식
- `GET /wiki/api/v2/folders/{id}/descendants` 조회
- folder descendants 결과의 folder/page 계층 구조 보존
- page 상세 조회를 통한 제목, ID, parent ID, version, source URL 수집
- `_links.next` cursor pagination 처리
- 개별 page 상세 조회 실패를 `errors`에 누적하고 나머지 page 조회 계속 진행

Markdown 변환, 파일 저장, 반복 Pull 정책, 안전 삭제, Sync Panel 상세 UI는 Epic 5 이후에서 구현한다.

## External API Notes

- Atlassian 공식 문서 기준 folder descendants endpoint는 `GET /wiki/api/v2/folders/{id}/descendants`이다.
- Descendants 응답은 top-to-bottom 순서의 `results`와 pagination용 `_links.next`를 제공한다.
- Folder descendants 결과에는 `Database`, `Embed`, `Folder`, `Page`, `Whiteboard`가 포함될 수 있다.
- Descendants endpoint는 최소 정보만 반환하므로 page version과 source URL은 `GET /wiki/api/v2/pages/{id}` 상세 조회로 수집한다.
- 참고 문서:
  - [Confluence Cloud REST API v2 Descendants](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-descendants/)
  - [Confluence Cloud REST API v2 Folder](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-folder/)
  - [Confluence Cloud REST API v2 Page](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/)

## File Structure

- Modify: `src/confluence/pageTree.ts`
  - 기존 `fetchConfluencePageTree`와 `ConfluencePageTreeResult` 타입은 그대로 유지한다.
  - folder descendants에서만 folder 구조 노드를 보존하는 새 folder tree result 타입을 추가한다.
  - 새 API `fetchConfluenceRootContentTree`를 추가한다.
- Modify: `src/confluence/pageTree.test.ts`
  - folder root descendants pagination, folder 아래 page 계층 보존, 개별 page 상세 조회 실패, folder descendants 치명적 실패 테스트를 추가한다.
- Modify: `src/commands/pullTreeCommand.ts`
  - `PullTreeFetcher`가 `rootContentType/rootContentId`를 받도록 변경한다.
  - folder root 차단 메시지를 제거하고 실제 Pull을 호출한다.
- Modify: `src/commands/pullTreeCommand.test.ts`
  - folder root 프로젝트가 `fetchTree(settings, "folder", rootContentId)`를 호출하는지 검증한다.
  - 기존 folder root 미구현 Notice 테스트는 성공 테스트로 교체한다.
- Modify: `docs/mvp-epics.md`
  - Epic 4 확장 구현 계획 링크를 추가한다.

## Data Shape

기존 `ConfluencePageTreeResult`는 변경하지 않는다. Folder root 전용 결과만 folder/page 구조 노드를 담도록 확장하고, `pages`는 Markdown 저장 단계가 사용할 flat page 목록으로 유지한다.

```typescript
export type ConfluenceRootContentType = "page" | "folder";

export type ConfluenceFolderContentTreeNode = ConfluenceFolderPageTreeNode | ConfluenceFolderTreeNode;

export interface ConfluenceFolderPageTreeNode extends ConfluencePageTreePage {
  children: ConfluenceFolderContentTreeNode[];
}

export interface ConfluenceFolderTreeNode {
  nodeType: "folder";
  contentId: string;
  title: string;
  parentId: string | null;
  depth: number;
  childPosition: number;
  children: ConfluenceFolderContentTreeNode[];
}

export interface ConfluenceFolderTreeSuccess {
  ok: true;
  root: ConfluenceFolderTreeNode;
  pages: ConfluencePageTreePage[];
  errors: ConfluencePageTreeError[];
}

export type ConfluenceFolderTreeResult = ConfluenceFolderTreeSuccess | ConfluencePageTreeFailure;
export type ConfluenceRootContentTreeResult = ConfluencePageTreeResult | ConfluenceFolderTreeResult;
```

## Pseudocode

```text
function fetchConfluenceRootContentTree(settings, rootContentType, rootContentId, transport):
  if rootContentType is "page":
    return fetchConfluencePageTree(settings, rootContentId, transport)

  if rootContentType is "folder":
    return fetchConfluenceFolderTree(settings, rootContentId, transport)

function fetchConfluenceFolderTree(settings, rootFolderId, transport):
  rootNode = folder node from current project title/root url and rootFolderId
  descendantsPath = /wiki/api/v2/folders/{rootFolderId}/descendants?limit=100
  flatPages starts empty

  descendantSummaries = []
  while descendantsPath exists:
    response = GET descendantsPath
    if response is not 200 or body is invalid:
      return critical failure
    append supported page/folder summaries
    descendantsPath = response._links.next converted to same-origin API path

  structuralFolders = folder summaries mapped as folder nodes
  pageSummaries = page summaries only
  errors = []

  for each pageSummary in pageSummaries:
    detail = GET /wiki/api/v2/pages/{pageSummary.id}
    if detail succeeds:
      flatPages append detail merged with parentId/depth/childPosition
    else:
      errors append pageId, title, reason, message

  tree = attach rootNode + structuralFolders + fetched page nodes by parentId using original descendants order and childPosition tie-breaker
  return success with root tree, flatPages, errors
```

## Task 1: Folder-Aware Tree Model Tests

**Files:**
- Modify: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Add failing folder root hierarchy test**

Append this test inside `describe("fetchConfluencePageTree", ...)` or rename the suite to `describe("fetchConfluenceRootContentTree", ...)` after importing the new function.

```typescript
import { fetchConfluencePageTree, fetchConfluenceRootContentTree } from "./pageTree";
```

```typescript
it("fetches paginated folder descendants and preserves folder/page hierarchy", async () => {
  const { requests, transport } = createSequencedTransport([
    {
      status: 200,
      json: {
        results: [
          { id: "folder-200", title: "Design", type: "folder", parentId: "folder-100", depth: 1, childPosition: 0 },
          { id: "page-300", title: "Overview", type: "page", parentId: "folder-200", depth: 2, childPosition: 0 }
        ],
        _links: { next: "/wiki/api/v2/folders/folder-100/descendants?limit=100&cursor=next-token" }
      }
    },
    {
      status: 200,
      json: {
        results: [
          { id: "page-400", title: "Root Child", type: "page", parentId: "folder-100", depth: 1, childPosition: 1 },
          { id: "whiteboard-500", title: "Ignored Whiteboard", type: "whiteboard", parentId: "folder-100", depth: 1, childPosition: 2 }
        ],
        _links: {}
      }
    },
    {
      status: 200,
      json: {
        id: "page-300",
        title: "Overview",
        version: { number: 7 },
        _links: { webui: "/wiki/spaces/SPACE/pages/page-300/Overview" }
      }
    },
    {
      status: 200,
      json: {
        id: "page-400",
        title: "Root Child",
        version: { number: 9 },
        _links: { webui: "/wiki/spaces/SPACE/pages/page-400/Root+Child" }
      }
    }
  ]);

  const result = await fetchConfluenceRootContentTree(
    createSettings({
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
    "folder",
    "folder-100",
    transport
  );

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  expect(requests.map((request) => request.url)).toEqual([
    "https://selta.atlassian.net/wiki/api/v2/folders/folder-100/descendants?limit=100",
    "https://selta.atlassian.net/wiki/api/v2/folders/folder-100/descendants?limit=100&cursor=next-token",
    "https://selta.atlassian.net/wiki/api/v2/pages/page-300",
    "https://selta.atlassian.net/wiki/api/v2/pages/page-400"
  ]);
  expect(result.pages.map((page) => page.pageId)).toEqual(["page-300", "page-400"]);
  expect(result.root).toMatchObject({
    nodeType: "folder",
    contentId: "folder-100",
    title: "Folder Root",
    parentId: null,
    depth: 0,
    childPosition: 0
  });
  expect(result.root.children.map((child) => child.nodeType === "folder" ? child.contentId : child.pageId)).toEqual([
    "folder-200",
    "page-400"
  ]);
  const designFolder = result.root.children[0];
  expect("nodeType" in designFolder ? designFolder.nodeType : "page").toBe("folder");
  if (!("nodeType" in designFolder) || designFolder.nodeType !== "folder") {
    throw new Error("Expected a folder node");
  }
  expect(designFolder.children.map((child) => "pageId" in child ? child.pageId : child.contentId)).toEqual([
    "page-300"
  ]);
  expect(result.errors).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: FAIL because `fetchConfluenceRootContentTree` is not exported.

## Task 2: Add Folder Descendant Summary Parsing

**Files:**
- Modify: `src/confluence/pageTree.ts`
- Test: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Add folder-aware summary types without changing page-only parsing**

In `src/confluence/pageTree.ts`, keep the existing `DescendantPageSummary`, `toDescendantPageSummaries`, and `fetchDescendantPageSummaries` code for page root Pull. Add these folder root types below `DescendantPageSummary`.

```typescript
export type ConfluenceRootContentType = "page" | "folder";

type DescendantContentType = "page" | "folder";

interface DescendantContentSummary {
  id: string;
  title: string;
  type: DescendantContentType;
  parentId: string;
  depth: number;
  childPosition: number;
}

type DescendantPageSummary = DescendantContentSummary & { type: "page" };
type DescendantFolderSummary = DescendantContentSummary & { type: "folder" };
```

- [ ] **Step 2: Add folder-aware summary guard and mapper**

Keep `isDescendantPageSummary`, `isDescendantResultWithType`, and `toDescendantPageSummaries` for existing page root behavior. Add this folder-aware mapper for folder root Pull.

```typescript
function isDescendantContentSummary(value: unknown): value is DescendantContentSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const summary = value as DescendantContentSummary;

  return (
    typeof summary.id === "string" &&
    typeof summary.title === "string" &&
    (summary.type === "page" || summary.type === "folder") &&
    typeof summary.parentId === "string" &&
    typeof summary.depth === "number" &&
    typeof summary.childPosition === "number"
  );
}

function isDescendantResultWithType(value: unknown): value is { type: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as { type?: unknown }).type === "string";
}

function toDescendantContentSummaries(response: DescendantsApiResponse): DescendantContentSummary[] | ConfluencePageTreeFailure {
  const summaries: DescendantContentSummary[] = [];

  for (const result of response.results ?? []) {
    if (!isDescendantResultWithType(result)) {
      return buildFailure("invalid-response", "Confluence 하위 콘텐츠 목록 형식이 올바르지 않습니다.");
    }

    if (result.type !== "page" && result.type !== "folder") {
      continue;
    }

    if (!isDescendantContentSummary(result)) {
      return buildFailure("invalid-response", "Confluence 하위 콘텐츠 목록 형식이 올바르지 않습니다.");
    }

    summaries.push(result);
  }

  return summaries;
}
```

- [ ] **Step 3: Add folder descendants fetcher**

Keep `fetchDescendantPageSummaries` unchanged for page root Pull. Add this folder-specific descendants fetcher.

```typescript
async function fetchFolderDescendantContentSummaries(
  settings: ConfluenceSyncSettings,
  rootFolderId: string,
  transport: ConfluenceRequestTransport
): Promise<DescendantContentSummary[] | ConfluencePageTreeFailure> {
  const summaries: DescendantContentSummary[] = [];
  let nextRequestPath: string | null = `/wiki/api/v2/folders/${encodeURIComponent(rootFolderId)}/descendants?limit=100`;

  while (nextRequestPath !== null) {
    const descendantsResponse = await requestConfluence(
      transport,
      createConfluenceGetRequest(settings, nextRequestPath)
    );

    if (isPageTreeFailure(descendantsResponse)) {
      return descendantsResponse;
    }

    if (descendantsResponse.status !== 200) {
      return classifyHttpFailure(descendantsResponse.status);
    }

    if (!isDescendantsApiResponse(descendantsResponse.json)) {
      return buildFailure("invalid-response", "Confluence descendants 응답 형식이 올바르지 않습니다.");
    }

    const contentSummaries = toDescendantContentSummaries(descendantsResponse.json);

    if (isPageTreeFailure(contentSummaries)) {
      return contentSummaries;
    }

    summaries.push(...contentSummaries);

    const rawNextLink = readNextLink(descendantsResponse.json);

    if (rawNextLink === null) {
      nextRequestPath = null;
      continue;
    }

    const nextApiPath = toApiPath(settings, rawNextLink);

    if (isPageTreeFailure(nextApiPath)) {
      return nextApiPath;
    }

    nextRequestPath = nextApiPath;
  }

  return summaries;
}
```

- [ ] **Step 4: Run page tree tests to confirm current failures are isolated**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: FAIL only because the exported folder root fetch function and folder tree builder do not exist yet. Existing page root tests must still PASS if the new folder root test is skipped.

## Task 3: Add Folder Structural Nodes

**Files:**
- Modify: `src/confluence/pageTree.ts`
- Test: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Add folder result interfaces without replacing page result interfaces**

Do not replace existing `ConfluencePageTreePage`, `ConfluencePageTreeNode`, `ConfluencePageTreeSuccess`, or `ConfluencePageTreeResult`. Add these folder result interfaces below the existing page tree result types.

```typescript
export type ConfluenceFolderContentTreeNode = ConfluenceFolderPageTreeNode | ConfluenceFolderTreeNode;

export interface ConfluenceFolderPageTreeNode extends ConfluencePageTreePage {
  children: ConfluenceFolderContentTreeNode[];
}

export interface ConfluenceFolderTreeNode {
  nodeType: "folder";
  contentId: string;
  title: string;
  parentId: string | null;
  depth: number;
  childPosition: number;
  children: ConfluenceFolderContentTreeNode[];
}

export interface ConfluenceFolderTreeSuccess {
  ok: true;
  root: ConfluenceFolderTreeNode;
  pages: ConfluencePageTreePage[];
  errors: ConfluencePageTreeError[];
}

export type ConfluenceFolderTreeResult = ConfluenceFolderTreeSuccess | ConfluencePageTreeFailure;
export type ConfluenceRootContentTreeResult = ConfluencePageTreeResult | ConfluenceFolderTreeResult;
```

- [ ] **Step 2: Keep page mapping helpers unchanged**

Do not add `nodeType` to `ConfluencePageTreePage`. Existing page root tests and consumers should keep using `page.pageId` directly.

```typescript
function isFolderContentPageNode(node: ConfluenceFolderContentTreeNode): node is ConfluenceFolderPageTreeNode {
  return "pageId" in node;
}
```

- [ ] **Step 3: Add folder node helper**

Add these helper functions near the page mapping helpers.

```typescript
function toRootFolder(settings: ConfluenceSyncSettings, rootFolderId: string): ConfluenceFolderTreeNode {
  const currentProject = settings.currentProject;
  const title =
    currentProject?.rootContentType === "folder" && currentProject.rootContentId === rootFolderId
      ? currentProject.projectName
      : `Confluence Folder ${rootFolderId}`;

  return {
    nodeType: "folder",
    contentId: rootFolderId,
    title,
    parentId: null,
    depth: 0,
    childPosition: 0,
    children: []
  };
}

function toFolderTreeNode(summary: DescendantFolderSummary): ConfluenceFolderTreeNode {
  return {
    nodeType: "folder",
    contentId: summary.id,
    title: summary.title,
    parentId: summary.parentId,
    depth: summary.depth,
    childPosition: summary.childPosition,
    children: []
  };
}

function getFolderContentNodeId(node: ConfluenceFolderContentTreeNode): string {
  return isFolderContentPageNode(node) ? node.pageId : node.contentId;
}
```

- [ ] **Step 4: Replace page-only tree builder**

Keep `PageTreeBuildResult`, `buildPageTree`, and `sortPageTreeChildren` unchanged for page root Pull. Add this folder-specific builder.

```typescript
interface FolderTreeBuildResult {
  root: ConfluenceFolderTreeNode;
  errors: ConfluencePageTreeError[];
  reachableContentIds: Set<string>;
}

interface OrderedDescendantContentSummary extends DescendantContentSummary {
  originalIndex: number;
}

function buildFolderContentTree(
  rootNode: ConfluenceFolderTreeNode,
  orderedDescendants: OrderedDescendantContentSummary[],
  descendantPages: ConfluencePageTreePage[]
): FolderTreeBuildResult {
  const errors: ConfluencePageTreeError[] = [];
  const rootNodeWithChildren: ConfluenceFolderTreeNode = {
    ...rootNode,
    children: []
  };
  const nodesByContentId = new Map<string, ConfluenceFolderContentTreeNode>([
    [rootNodeWithChildren.contentId, rootNodeWithChildren]
  ]);
  const originalIndexesByContentId = new Map<string, number>([[rootNodeWithChildren.contentId, -1]]);
  const erroredContentIds = new Set<string>();

  for (const summary of orderedDescendants) {
    originalIndexesByContentId.set(summary.id, summary.originalIndex);

    if (summary.type === "folder") {
      const folderNode = toFolderTreeNode(summary);
      nodesByContentId.set(folderNode.contentId, folderNode);
      continue;
    }

    const page = descendantPages.find((candidate) => candidate.pageId === summary.id);

    if (page !== undefined) {
      nodesByContentId.set(page.pageId, {
        ...page,
        children: []
      });
    }
  }

  const childNodes = orderedDescendants.map((summary) => nodesByContentId.get(summary.id));

  for (const node of childNodes) {
    if (node === undefined) {
      continue;
    }

    const parentNode = nodesByContentId.get(node.parentId ?? "");

    if (parentNode === undefined) {
      const contentId = getFolderContentNodeId(node);
      erroredContentIds.add(contentId);
      errors.push(
        buildPageTreeError(
          contentId,
          node.title,
          "invalid-response",
          `Confluence 콘텐츠(${contentId})의 부모(${node.parentId ?? "unknown"})를 페이지 트리에 연결할 수 없습니다.`
        )
      );
      continue;
    }

    parentNode.children.push(node);
  }

  sortFolderContentTreeChildren(rootNodeWithChildren, originalIndexesByContentId);
  const reachableContentIds = collectReachableFolderContentIds(rootNodeWithChildren);

  for (const [contentId, node] of nodesByContentId) {
    if (contentId === rootNodeWithChildren.contentId || reachableContentIds.has(contentId) || erroredContentIds.has(contentId)) {
      continue;
    }

    errors.push(
      buildPageTreeError(
        contentId,
        node.title,
        "invalid-response",
        `Confluence 콘텐츠(${contentId})는 루트 폴더(${rootNodeWithChildren.contentId})에서 도달할 수 없습니다.`
      )
    );
  }

  return { root: rootNodeWithChildren, errors, reachableContentIds };
}

function collectReachableFolderContentIds(rootNode: ConfluenceFolderContentTreeNode): Set<string> {
  const reachableContentIds = new Set<string>();
  const pendingNodes: ConfluenceFolderContentTreeNode[] = [rootNode];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();

    if (node === undefined) {
      continue;
    }

    reachableContentIds.add(getFolderContentNodeId(node));
    pendingNodes.push(...node.children);
  }

  return reachableContentIds;
}

function sortFolderContentTreeChildren(
  node: ConfluenceFolderContentTreeNode,
  originalIndexesByContentId: Map<string, number>
): void {
  node.children.sort((leftNode, rightNode) => {
    const childPositionDifference = leftNode.childPosition - rightNode.childPosition;

    if (childPositionDifference !== 0) {
      return childPositionDifference;
    }

    return (
      (originalIndexesByContentId.get(getFolderContentNodeId(leftNode)) ?? 0) -
      (originalIndexesByContentId.get(getFolderContentNodeId(rightNode)) ?? 0)
    );
  });

  for (const child of node.children) {
    sortFolderContentTreeChildren(child, originalIndexesByContentId);
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: Existing page root tests still PASS, and folder root tests fail until the folder fetcher is exported in the next task.

## Task 4: Export Root Content Pull API

**Files:**
- Modify: `src/confluence/pageTree.ts`
- Test: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Add root content fetcher**

Keep the existing `fetchConfluencePageTree` implementation unchanged. Add `fetchConfluenceFolderTree` and `fetchConfluenceRootContentTree` below it.

```typescript
export async function fetchConfluenceFolderTree(
  settings: ConfluenceSyncSettings,
  rootFolderId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceFolderTreeResult> {
  const rootNode = toRootFolder(settings, rootFolderId);
  const descendantSummaries = await fetchFolderDescendantContentSummaries(settings, rootFolderId, transport);

  if (isPageTreeFailure(descendantSummaries)) {
    return descendantSummaries;
  }

  const orderedDescendants = descendantSummaries.map((summary, originalIndex) => ({
    ...summary,
    originalIndex
  }));
  const descendantPageSummaries = orderedDescendants.filter(
    (summary): summary is DescendantPageSummary => summary.type === "page"
  );
  const descendantPages = await fetchDescendantPages(settings, descendantPageSummaries, transport);
  const folderTree = buildFolderContentTree(rootNode, orderedDescendants, descendantPages.pages);
  const reachablePages = descendantPages.pages.filter((page) => folderTree.reachableContentIds.has(page.pageId));

  return {
    ok: true,
    root: folderTree.root,
    pages: reachablePages,
    errors: [...descendantPages.errors, ...folderTree.errors]
  };
}

export async function fetchConfluenceRootContentTree(
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceRootContentTreeResult> {
  if (rootContentType === "page") {
    return fetchConfluencePageTree(settings, rootContentId, transport);
  }

  return fetchConfluenceFolderTree(settings, rootContentId, transport);
}
```

- [ ] **Step 2: Add folder node assertion helper to tests**

Add these helpers to `src/confluence/pageTree.test.ts` near the existing test helpers.

```typescript
function toFolderChildIds(children: Array<{ pageId?: string; contentId?: string }>): string[] {
  return children.map((child) => child.pageId ?? child.contentId ?? "missing-id");
}

function expectFolderNode(
  node: { nodeType?: string; contentId?: string; children?: unknown[] },
  expectedContentId: string
): asserts node is { nodeType: "folder"; contentId: string; children: Array<{ pageId?: string; contentId?: string }> } {
  expect(node.nodeType).toBe("folder");
  expect(node.contentId).toBe(expectedContentId);
  expect(Array.isArray(node.children)).toBe(true);
}
```

Use those helpers in folder root tests:

```typescript
expectFolderNode(result.root, "folder-100");
expect(toFolderChildIds(result.root.children)).toEqual(["folder-200", "page-400"]);
const designFolder = result.root.children[0];
expectFolderNode(designFolder, "folder-200");
expect(toFolderChildIds(designFolder.children)).toEqual(["page-300"]);
```

- [ ] **Step 3: Run page tree tests**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: PASS. Existing page root tests should not require `nodeType` changes.

## Task 5: Folder Page Detail Partial Failure

**Files:**
- Modify: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Add failing partial failure test**

Append this test to `src/confluence/pageTree.test.ts`.

```typescript
it("records folder descendant page detail errors and continues pulling accessible pages", async () => {
  const { transport } = createSequencedTransport([
    {
      status: 200,
      json: {
        results: [
          { id: "folder-200", title: "Nested Folder", type: "folder", parentId: "folder-100", depth: 1, childPosition: 0 },
          { id: "page-200", title: "Forbidden", type: "page", parentId: "folder-200", depth: 2, childPosition: 0 },
          { id: "page-300", title: "Accessible", type: "page", parentId: "folder-200", depth: 2, childPosition: 1 }
        ],
        _links: {}
      }
    },
    {
      status: 403,
      json: {}
    },
    {
      status: 200,
      json: {
        id: "page-300",
        title: "Accessible",
        version: { number: 4 },
        _links: { webui: "/wiki/spaces/SPACE/pages/page-300/Accessible" }
      }
    }
  ]);

  const result = await fetchConfluenceRootContentTree(createSettings(), "folder", "folder-100", transport);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  expect(result.pages.map((page) => page.pageId)).toEqual(["page-300"]);
  expect(result.root.children.map((child) => "pageId" in child ? child.pageId : child.contentId)).toEqual([
    "folder-200"
  ]);
  const nestedFolder = result.root.children[0];
  expect("nodeType" in nestedFolder ? nestedFolder.nodeType : "page").toBe("folder");
  if (!("nodeType" in nestedFolder) || nestedFolder.nodeType !== "folder") {
    throw new Error("Expected a folder node");
  }
  expect(nestedFolder.children.map((child) => "pageId" in child ? child.pageId : child.contentId)).toEqual([
    "page-300"
  ]);
  expect(result.errors).toEqual([
    {
      pageId: "page-200",
      title: "Forbidden",
      reason: "permission-denied",
      message: "Confluence 페이지 트리에 접근할 권한이 없습니다."
    }
  ]);
});
```

- [ ] **Step 2: Run page tree tests**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: PASS because Task 4 reuses existing descendant page detail error handling.

## Task 6: Folder Descendants Critical Failure

**Files:**
- Modify: `src/confluence/pageTree.test.ts`

- [ ] **Step 1: Add detached subtree reachability test**

Append this test to `src/confluence/pageTree.test.ts`.

```typescript
it("records pages under detached folder branches as errors instead of successful pages", async () => {
  const { transport } = createSequencedTransport([
    {
      status: 200,
      json: {
        results: [
          { id: "page-200", title: "Forbidden Parent", type: "page", parentId: "folder-100", depth: 1, childPosition: 0 },
          { id: "folder-300", title: "Detached Folder", type: "folder", parentId: "page-200", depth: 2, childPosition: 0 },
          { id: "page-400", title: "Detached Child", type: "page", parentId: "folder-300", depth: 3, childPosition: 0 },
          { id: "page-500", title: "Accessible Sibling", type: "page", parentId: "folder-100", depth: 1, childPosition: 1 }
        ],
        _links: {}
      }
    },
    {
      status: 403,
      json: {}
    },
    {
      status: 200,
      json: {
        id: "page-400",
        title: "Detached Child",
        version: { number: 5 },
        _links: { webui: "/wiki/spaces/SPACE/pages/page-400/Detached+Child" }
      }
    },
    {
      status: 200,
      json: {
        id: "page-500",
        title: "Accessible Sibling",
        version: { number: 6 },
        _links: { webui: "/wiki/spaces/SPACE/pages/page-500/Accessible+Sibling" }
      }
    }
  ]);

  const result = await fetchConfluenceRootContentTree(createSettings(), "folder", "folder-100", transport);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  expect(result.pages.map((page) => page.pageId)).toEqual(["page-500"]);
  expect(toFolderChildIds(result.root.children)).toEqual(["page-500"]);
  expect(result.errors).toEqual([
    {
      pageId: "page-200",
      title: "Forbidden Parent",
      reason: "permission-denied",
      message: "Confluence 페이지 트리에 접근할 권한이 없습니다."
    },
    {
      pageId: "folder-300",
      title: "Detached Folder",
      reason: "invalid-response",
      message: "Confluence 콘텐츠(folder-300)의 부모(page-200)를 페이지 트리에 연결할 수 없습니다."
    },
    {
      pageId: "page-400",
      title: "Detached Child",
      reason: "invalid-response",
      message: "Confluence 콘텐츠(page-400)는 루트 폴더(folder-100)에서 도달할 수 없습니다."
    }
  ]);
});
```

- [ ] **Step 2: Run page tree tests to verify failure**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: FAIL because detached subtree pages are still included in `result.pages`.

- [ ] **Step 3: Add descendants failure test**

Append this test to `src/confluence/pageTree.test.ts`.

```typescript
it("returns a critical failure when folder descendants pagination fails", async () => {
  const { requests, transport } = createSequencedTransport([
    {
      status: 500,
      json: {}
    }
  ]);

  const result = await fetchConfluenceRootContentTree(createSettings(), "folder", "folder-100", transport);

  expect(requests.map((request) => request.url)).toEqual([
    "https://selta.atlassian.net/wiki/api/v2/folders/folder-100/descendants?limit=100"
  ]);
  expect(result).toEqual({
    ok: false,
    reason: "api-error",
    message: "Confluence API 오류가 발생했습니다. HTTP 500"
  });
});
```

- [ ] **Step 4: Run page tree tests**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts
```

Expected: PASS.

## Task 7: Pull Tree Command Uses Root Content Type

**Files:**
- Modify: `src/commands/pullTreeCommand.ts`
- Modify: `src/commands/pullTreeCommand.test.ts`

- [ ] **Step 1: Update command tests**

In `src/commands/pullTreeCommand.test.ts`, replace the folder root "Epic 4 확장 대상" test with this success-path test.

```typescript
it("루트 콘텐츠가 폴더이면 folder rootContentId로 페이지 트리를 조회한다", async () => {
  const notices: string[] = [];
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
    fetchTree,
    showNotice: (message) => notices.push(message)
  });

  expect(fetchedRoots).toEqual([{ rootContentType: "folder", rootContentId: "folder-100" }]);
  expect(notices).toEqual(["Confluence 페이지 트리를 가져왔습니다: 0개"]);
});
```

Update the page root success test so `PullTreeFetcher` receives three arguments.

```typescript
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
```

Assert:

```typescript
expect(fetchedRoots).toEqual([{ rootContentType: "page", rootContentId: "100" }]);
```

- [ ] **Step 2: Run command tests to verify failure**

Run:

```bash
pnpm exec vitest run src/commands/pullTreeCommand.test.ts
```

Expected: FAIL because `PullTreeFetcher` still accepts `rootPageId` only and folder roots are still blocked.

- [ ] **Step 3: Update command implementation**

Replace `src/commands/pullTreeCommand.ts` with this implementation.

```typescript
import { getMissingConfluenceConnectionFields, type RequiredConfluenceConnectionField } from "../confluence/authentication";
import {
  fetchConfluenceRootContentTree,
  type ConfluenceRootContentTreeResult,
  type ConfluenceRootContentType
} from "../confluence/pageTree";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export type PullTreeFetcher = (
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string
) => Promise<ConfluenceRootContentTreeResult>;

export interface RunPullTreeCommandInput {
  settings: ConfluenceSyncSettings;
  fetchTree?: PullTreeFetcher;
  showNotice: (message: string) => void;
}

const defaultPullTreeFetcher: PullTreeFetcher = async (settings, rootContentType, rootContentId) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return fetchConfluenceRootContentTree(settings, rootContentType, rootContentId, createObsidianRequestTransport);
};

export async function runPullTreeCommand({
  settings,
  fetchTree = defaultPullTreeFetcher,
  showNotice
}: RunPullTreeCommandInput): Promise<void> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    showNotice(
      `Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields
        .map(toSettingsFieldName)
        .join(", ")}`
    );
    return;
  }

  const currentProject = settings.currentProject;

  if (currentProject === null) {
    showNotice("Pull Tree 실행 전에 설정 화면에서 루트 콘텐츠 기반 프로젝트를 생성하세요.");
    return;
  }

  try {
    const result = await fetchTree(settings, currentProject.rootContentType, currentProject.rootContentId);

    if (!result.ok) {
      showNotice(result.message);
      return;
    }

    const errorMessage = result.errors.length > 0 ? `, 실패 ${result.errors.length}개` : "";
    showNotice(`Confluence 페이지 트리를 가져왔습니다: ${result.pages.length}개${errorMessage}`);
  } catch (error) {
    console.error("Pull Tree 실행 중 예기치 못한 오류가 발생했습니다.", error);

    const message = error instanceof Error ? error.message : "Confluence 페이지 트리 조회 중 알 수 없는 오류가 발생했습니다.";
    showNotice(message);
  }
}

function toSettingsFieldName(field: RequiredConfluenceConnectionField): string {
  return field === "API token" ? "apiToken" : field;
}
```

- [ ] **Step 4: Run command tests**

Run:

```bash
pnpm exec vitest run src/commands/pullTreeCommand.test.ts
```

Expected: PASS.

## Task 8: Full Verification

**Files:**
- Modify: `docs/mvp-epics.md`

- [ ] **Step 1: Ensure Epic 4 extension plan link exists**

Under `## Epic 4 확장. 루트 폴더 트리 Pull`, add this link only if it is not already present:

```markdown
### 구현 계획

- [Root Folder Tree Pull Implementation Plan](superpowers/plans/2026-04-27-root-folder-tree-pull.md)
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm exec vitest run src/confluence/pageTree.test.ts src/commands/pullTreeCommand.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm run verify
```

Expected: PASS for lint, test, and build.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/mvp-epics.md src/confluence/pageTree.ts src/confluence/pageTree.test.ts src/commands/pullTreeCommand.ts src/commands/pullTreeCommand.test.ts
git add -f docs/superpowers/plans/2026-04-27-root-folder-tree-pull.md
git commit -m "feat: support root folder tree pull"
```

## Self-Review

- Spec coverage: folder root 인식은 Task 7, folder descendants 조회와 pagination은 Task 1/2/4, 계층 보존은 Task 3/4, page 메타데이터 수집은 Task 4/5, 일부 page 조회 실패 누적은 Task 5에서 다룬다.
- Placeholder scan: 이 계획에는 `TBD`, `TODO`, `implement later`, 비어 있는 테스트 지시가 없다.
- Type consistency: `ConfluenceRootContentType`, `ConfluenceFolderContentTreeNode`, `ConfluenceFolderPageTreeNode`, `ConfluenceFolderTreeNode`, `ConfluenceFolderTreeResult`, `ConfluenceRootContentTreeResult`, `fetchConfluenceFolderTree`, `fetchConfluenceRootContentTree`, `PullTreeFetcher` 시그니처를 모든 작업에서 같은 이름으로 사용한다.
