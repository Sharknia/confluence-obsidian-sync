# Root Folder Project Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confluence page URL과 folder URL을 같은 설정 UI에서 받아 로컬 프로젝트 manifest를 생성하고, 이후 Pull 로직이 root content type에 따라 page/folder descendants API를 선택할 수 있게 한다.

**Architecture:** 기존 page 루트 생성 흐름을 일반화한다. URL 파서는 `page` 또는 `folder` 루트 식별자를 반환하고, 생성 서비스는 content type에 따라 page/folder 메타데이터 조회 함수를 호출한 뒤 동일한 manifest writer를 사용한다. Manifest와 현재 프로젝트 설정에는 `rootContentType`과 `rootContentId`를 추가하되 기존 `rootPageId`는 하위 호환 필드로 유지한다.

**Tech Stack:** TypeScript, Obsidian Plugin API, Confluence Cloud REST API v2, Vitest, ESLint, pnpm.

---

## File Structure

- Modify: `src/confluence/pageUrl.ts`
  - `parseConfluencePageUrl`을 유지하면서, page/folder를 모두 처리하는 `parseConfluenceRootUrl`을 추가한다.
  - folder URL은 `/wiki/spaces/{spaceKey}/folders/{folderId}` 형식과 query/hash 정리를 지원한다.
- Modify: `src/confluence/pageUrl.test.ts`
  - 기존 page URL 테스트는 유지하고, root URL 파서와 folder URL 테스트를 추가한다.
- Create: `src/confluence/rootFolderMetadata.ts`
  - `/wiki/api/v2/folders/{folderId}`를 호출해 folder id, title, spaceId를 읽는다.
  - 인증 실패, 권한 없음, not found, 네트워크, invalid response, 기타 API 오류를 page 메타데이터와 같은 방식으로 분류한다.
- Create: `src/confluence/rootFolderMetadata.test.ts`
  - 성공 요청 URL/header와 주요 실패 분류를 검증한다.
- Modify: `src/projects/projectManifest.ts`
  - `RootContentType = "page" | "folder"` 타입을 추가한다.
  - manifest 입력과 출력에 `rootContentType`, `rootContentId`를 추가한다.
  - path 생성은 content type을 반영해 `confluence-page-{id}` 또는 `confluence-folder-{id}`가 되게 한다.
- Modify: `src/projects/projectManifest.test.ts`
  - page manifest 기본값, folder manifest, page/folder path 분리를 검증한다.
- Modify: `src/projects/projectStorage.ts`
  - 기존 manifest identity 비교가 `rootContentType/rootContentId`를 우선 사용하게 하고, 기존 manifest는 `rootPageId` 기반으로 계속 같은 프로젝트로 인식한다.
- Modify: `src/projects/projectStorage.test.ts`
  - folder manifest 갱신과 page/folder 충돌 방지 케이스를 추가한다.
- Modify: `src/projects/createProjectFromRootUrl.ts`
  - `parseConfluenceRootUrl` 결과에 따라 page 또는 folder metadata를 조회한다.
  - 성공 결과의 `currentProject`에 `rootContentType/rootContentId`를 포함한다.
- Modify: `src/projects/createProjectFromRootUrl.test.ts`
  - folder URL로 프로젝트 생성 시 folder endpoint, manifest, currentProject를 검증한다.
- Modify: `src/settings/defaultSettings.ts`
  - `CurrentConfluenceProjectSettings`에 `rootContentType/rootContentId`를 추가한다.
  - 저장된 기존 page 프로젝트는 로드 시 자동으로 `rootContentType: "page"`, `rootContentId: rootPageId`가 채워지게 한다.
- Modify: `src/settings/defaultSettings.test.ts`
  - 기존 current project 마이그레이션과 새 folder project 로드를 검증한다.
- Modify: `src/settings/ConfluenceSyncSettingTab.ts`
  - UI 문구를 "Root content URL"로 바꾸고 page/folder URL을 모두 허용한다.
- Modify: `src/main.ts`
  - current project가 없을 때 안내 문구를 "루트 콘텐츠 기반 프로젝트"로 바꾼다.
- Modify: `docs/mvp-epics.md`
  - Epic 3 확장에 구현 계획 링크를 추가한다.

## Task 1: Root URL Parser

**Files:**
- Modify: `src/confluence/pageUrl.ts`
- Test: `src/confluence/pageUrl.test.ts`

- [ ] **Step 1: Write failing parser tests**

Append these tests to `src/confluence/pageUrl.test.ts` below the existing imports and test suites. Keep the existing `parseConfluencePageUrl` tests unchanged.

```ts
import { parseConfluencePageUrl, parseConfluenceRootUrl } from "./pageUrl";

describe("parseConfluenceRootUrl", () => {
  it("returns page content details for existing page URLs", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root#section",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: true,
      rootContentType: "page",
      rootContentId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root"
    });
  });

  it("parses a modern Confluence folder URL and strips hash and query parameters", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder?atlOrigin=abc#children",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: true,
      rootContentType: "folder",
      rootContentId: "987654321",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder"
    });
  });

  it("rejects unsupported same-origin URLs without page or folder ids", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-root-content-id",
      message: "Confluence 루트 콘텐츠 URL에서 pageId 또는 folderId를 찾을 수 없습니다."
    });
  });
});
```

Also add this focused test inside the existing `describe("parseConfluencePageUrl", ...)` suite to ensure the page-only API remains strict:

```ts
it("rejects folder URLs in the page-only parser", () => {
  const result = parseConfluencePageUrl(
    "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
    "https://selta.atlassian.net"
  );

  expect(result).toEqual({
    ok: false,
    reason: "missing-page-id",
    message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
  });
});
```

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
pnpm exec vitest run src/confluence/pageUrl.test.ts
```

Expected: FAIL because `parseConfluenceRootUrl` is not exported.

- [ ] **Step 3: Implement the root URL parser**

Replace `src/confluence/pageUrl.ts` with this implementation. It preserves `parseConfluencePageUrl` behavior and adds the root-content parser.

```ts
import { normalizeConfluenceBaseUrl } from "../settings/defaultSettings";

export type ConfluenceRootContentType = "page" | "folder";

export type ConfluenceRootUrlParseFailureReason =
  | "invalid-url"
  | "base-url-mismatch"
  | "missing-root-content-id";

export interface ConfluenceRootUrlParseSuccess {
  ok: true;
  rootContentType: ConfluenceRootContentType;
  rootContentId: string;
  rootUrl: string;
}

export interface ConfluenceRootUrlParseFailure {
  ok: false;
  reason: ConfluenceRootUrlParseFailureReason;
  message: string;
}

export type ConfluenceRootUrlParseResult = ConfluenceRootUrlParseSuccess | ConfluenceRootUrlParseFailure;

export type ConfluencePageUrlParseFailureReason = "invalid-url" | "base-url-mismatch" | "missing-page-id";

export interface ConfluencePageUrlParseSuccess {
  ok: true;
  pageId: string;
  rootUrl: string;
}

export interface ConfluencePageUrlParseFailure {
  ok: false;
  reason: ConfluencePageUrlParseFailureReason;
  message: string;
}

export type ConfluencePageUrlParseResult = ConfluencePageUrlParseSuccess | ConfluencePageUrlParseFailure;

export function parseConfluencePageUrl(rawRootUrl: string, rawBaseUrl: string): ConfluencePageUrlParseResult {
  const rootUrlResult = parseConfluenceRootUrl(rawRootUrl, rawBaseUrl);

  if (!rootUrlResult.ok) {
    return {
      ok: false,
      reason: toPageUrlFailureReason(rootUrlResult.reason),
      message:
        rootUrlResult.reason === "missing-root-content-id"
          ? "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
          : rootUrlResult.message
    };
  }

  if (rootUrlResult.rootContentType !== "page") {
    return {
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    };
  }

  return {
    ok: true,
    pageId: rootUrlResult.rootContentId,
    rootUrl: rootUrlResult.rootUrl
  };
}

export function parseConfluenceRootUrl(rawRootUrl: string, rawBaseUrl: string): ConfluenceRootUrlParseResult {
  const normalizedBaseUrl = normalizeConfluenceBaseUrl(rawBaseUrl);

  const rootUrlResult = tryParseUrl(rawRootUrl, "Confluence 루트 콘텐츠 URL");

  if (!rootUrlResult.ok) {
    return rootUrlResult;
  }

  const baseUrlResult = tryParseUrl(normalizedBaseUrl, "Confluence base URL");

  if (!baseUrlResult.ok) {
    return baseUrlResult;
  }

  const rootUrl = rootUrlResult.url;
  const baseUrl = baseUrlResult.url;

  if (rootUrl.origin !== baseUrl.origin) {
    return {
      ok: false,
      reason: "base-url-mismatch",
      message: "Confluence 루트 콘텐츠 URL의 origin이 base URL과 일치하지 않습니다."
    };
  }

  const rootDetails = extractConfluenceRootDetails(rootUrl);

  if (rootDetails === null) {
    return {
      ok: false,
      reason: "missing-root-content-id",
      message: "Confluence 루트 콘텐츠 URL에서 pageId 또는 folderId를 찾을 수 없습니다."
    };
  }

  return {
    ok: true,
    rootContentType: rootDetails.rootContentType,
    rootContentId: rootDetails.rootContentId,
    rootUrl: buildCanonicalRootUrl(rootUrl, rootDetails)
  };
}

type ConfluencePageUrlKind = "modern-page" | "legacy-viewpage";

interface ConfluenceRootDetails {
  rootContentType: ConfluenceRootContentType;
  rootContentId: string;
  kind: ConfluencePageUrlKind | "modern-folder";
}

function extractConfluenceRootDetails(url: URL): ConfluenceRootDetails | null {
  const queryPageId = url.searchParams.get("pageId");

  if (url.pathname === "/wiki/pages/viewpage.action") {
    return isNumericContentId(queryPageId)
      ? { rootContentType: "page", rootContentId: queryPageId, kind: "legacy-viewpage" }
      : null;
  }

  if (queryPageId !== null) {
    return null;
  }

  const pagePathMatch = url.pathname.match(/^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/[^/]+)?$/u);

  if (pagePathMatch?.[1] !== undefined) {
    return { rootContentType: "page", rootContentId: pagePathMatch[1], kind: "modern-page" };
  }

  const folderPathMatch = url.pathname.match(/^\/wiki\/spaces\/[^/]+\/folders\/(\d+)(?:\/[^/]+)?$/u);

  if (folderPathMatch?.[1] !== undefined) {
    return { rootContentType: "folder", rootContentId: folderPathMatch[1], kind: "modern-folder" };
  }

  return null;
}

function isNumericContentId(value: string | null): value is string {
  return typeof value === "string" && /^\d+$/u.test(value);
}

function buildCanonicalRootUrl(rootUrl: URL, rootDetails: ConfluenceRootDetails): string {
  if (rootDetails.kind === "legacy-viewpage") {
    return `${rootUrl.origin}${rootUrl.pathname}?pageId=${rootDetails.rootContentId}`;
  }

  return `${rootUrl.origin}${rootUrl.pathname}`;
}

function toPageUrlFailureReason(reason: ConfluenceRootUrlParseFailureReason): ConfluencePageUrlParseFailureReason {
  if (reason === "missing-root-content-id") {
    return "missing-page-id";
  }

  return reason;
}

function tryParseUrl(
  rawUrl: string,
  label: string
): { ok: true; url: URL } | { ok: false; reason: "invalid-url"; message: string } {
  try {
    return { ok: true, url: new URL(rawUrl) };
  } catch {
    return {
      ok: false,
      reason: "invalid-url",
      message: `${label}을 해석할 수 없습니다.`
    };
  }
}
```

- [ ] **Step 4: Run parser tests to verify pass**

Run:

```bash
pnpm exec vitest run src/confluence/pageUrl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit parser change**

```bash
git add src/confluence/pageUrl.ts src/confluence/pageUrl.test.ts
git commit -m "feat: parse confluence root folder urls"
```

## Task 2: Root Folder Metadata API

**Files:**
- Create: `src/confluence/rootFolderMetadata.ts`
- Test: `src/confluence/rootFolderMetadata.test.ts`

- [ ] **Step 1: Write failing metadata tests**

Create `src/confluence/rootFolderMetadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RequestUrlParam } from "obsidian";
import { buildBasicAuthorizationHeader } from "./authentication";
import { fetchRootFolderMetadata } from "./rootFolderMetadata";
import type { ConfluenceRequestTransport } from "./requestTransport";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

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

function createTransport(response: Awaited<ReturnType<ConfluenceRequestTransport>>): ConfluenceRequestTransport {
  return () => Promise.resolve(response);
}

describe("fetchRootFolderMetadata", () => {
  it("returns root folder metadata on success", async () => {
    const capturedRequests: RequestUrlParam[] = [];
    const transport: ConfluenceRequestTransport = (request) => {
      capturedRequests.push(request);

      return Promise.resolve({
        status: 200,
        json: {
          id: "987654321",
          title: "Team Folder",
          spaceId: "SPACE"
        }
      });
    };

    const result = await fetchRootFolderMetadata(createSettings(), "987654321", transport);

    expect(result).toEqual({
      ok: true,
      metadata: {
        folderId: "987654321",
        title: "Team Folder",
        spaceId: "SPACE"
      }
    });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]).toMatchObject({
      url: "https://selta.atlassian.net/wiki/api/v2/folders/987654321",
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthorizationHeader("owner@example.com", "secret-token")
      }
    });
  });

  it("classifies 403 as permission denied", async () => {
    const result = await fetchRootFolderMetadata(
      createSettings(),
      "987654321",
      createTransport({ status: 403, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "permission-denied",
      message: "루트 폴더에 접근할 권한이 없습니다."
    });
  });

  it("classifies 404 as not found", async () => {
    const result = await fetchRootFolderMetadata(
      createSettings(),
      "987654321",
      createTransport({ status: 404, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "not-found",
      message: "루트 폴더를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    });
  });

  it("classifies invalid response payloads as invalid-response", async () => {
    const result = await fetchRootFolderMetadata(
      createSettings(),
      "987654321",
      createTransport({
        status: 200,
        json: {
          id: "987654321",
          title: "Team Folder"
        }
      })
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence 루트 폴더 응답 형식이 올바르지 않습니다."
    });
  });

  it("classifies thrown transport errors as network errors", async () => {
    const transport: ConfluenceRequestTransport = () =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND selta.atlassian.net"));

    const result = await fetchRootFolderMetadata(createSettings(), "987654321", transport);

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 루트 폴더 메타데이터를 조회할 수 없습니다."
    });
  });

  it("classifies 401 as authentication failure", async () => {
    const result = await fetchRootFolderMetadata(
      createSettings(),
      "987654321",
      createTransport({ status: 401, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    });
  });

  it("classifies unexpected statuses as api-error", async () => {
    const result = await fetchRootFolderMetadata(
      createSettings(),
      "987654321",
      createTransport({ status: 500, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 500"
    });
  });
});
```

- [ ] **Step 2: Run metadata tests to verify failure**

Run:

```bash
pnpm exec vitest run src/confluence/rootFolderMetadata.test.ts
```

Expected: FAIL because `src/confluence/rootFolderMetadata.ts` does not exist.

- [ ] **Step 3: Implement folder metadata fetcher**

Create `src/confluence/rootFolderMetadata.ts`:

```ts
import { buildBasicAuthorizationHeader, buildConfluenceApiUrl } from "./authentication";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";

export type ConfluenceRootFolderMetadataFailureReason =
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "network-error"
  | "invalid-response"
  | "api-error";

export interface ConfluenceRootFolderMetadata {
  folderId: string;
  title: string;
  spaceId: string;
}

export interface ConfluenceRootFolderMetadataSuccess {
  ok: true;
  metadata: ConfluenceRootFolderMetadata;
}

export interface ConfluenceRootFolderMetadataFailure {
  ok: false;
  reason: ConfluenceRootFolderMetadataFailureReason;
  message: string;
}

export type ConfluenceRootFolderMetadataResult =
  | ConfluenceRootFolderMetadataSuccess
  | ConfluenceRootFolderMetadataFailure;

interface RootFolderMetadataApiResponse {
  id?: unknown;
  title?: unknown;
  spaceId?: unknown;
}

function buildApiErrorMessage(status: number): string {
  return `Confluence API 오류가 발생했습니다. HTTP ${status}`;
}

function isRootFolderMetadataResponse(value: unknown): value is RootFolderMetadataApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as RootFolderMetadataApiResponse;

  return typeof response.id === "string" && typeof response.title === "string" && typeof response.spaceId === "string";
}

function createRequestUrl(settings: ConfluenceSyncSettings, folderId: string): string {
  return buildConfluenceApiUrl(settings.confluenceBaseUrl, `/wiki/api/v2/folders/${encodeURIComponent(folderId)}`);
}

function createAuthorizationHeader(settings: ConfluenceSyncSettings): string {
  return buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken);
}

function createRequest(settings: ConfluenceSyncSettings, folderId: string) {
  return {
    url: createRequestUrl(settings, folderId),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function toMetadata(response: RootFolderMetadataApiResponse): ConfluenceRootFolderMetadata {
  return {
    folderId: response.id as string,
    title: response.title as string,
    spaceId: response.spaceId as string
  };
}

function buildFailure(
  reason: ConfluenceRootFolderMetadataFailureReason,
  message: string
): ConfluenceRootFolderMetadataFailure {
  return { ok: false, reason, message };
}

function classifyHttpFailure(status: number): ConfluenceRootFolderMetadataFailure {
  if (status === 401) {
    return buildFailure(
      "authentication-failed",
      "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    );
  }

  if (status === 403) {
    return buildFailure("permission-denied", "루트 폴더에 접근할 권한이 없습니다.");
  }

  if (status === 404) {
    return buildFailure("not-found", "루트 폴더를 찾을 수 없습니다. URL과 접근 권한을 확인하세요.");
  }

  return buildFailure("api-error", buildApiErrorMessage(status));
}

export async function fetchRootFolderMetadata(
  settings: ConfluenceSyncSettings,
  folderId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceRootFolderMetadataResult> {
  let response: ConfluenceRequestResult;

  try {
    response = await transport(createRequest(settings, folderId));
  } catch {
    return buildFailure(
      "network-error",
      "네트워크 오류로 루트 폴더 메타데이터를 조회할 수 없습니다."
    );
  }

  if (response.status !== 200) {
    return classifyHttpFailure(response.status);
  }

  if (!isRootFolderMetadataResponse(response.json)) {
    return buildFailure(
      "invalid-response",
      "Confluence 루트 폴더 응답 형식이 올바르지 않습니다."
    );
  }

  return {
    ok: true,
    metadata: toMetadata(response.json)
  };
}
```

- [ ] **Step 4: Run metadata tests to verify pass**

Run:

```bash
pnpm exec vitest run src/confluence/rootFolderMetadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit metadata change**

```bash
git add src/confluence/rootFolderMetadata.ts src/confluence/rootFolderMetadata.test.ts
git commit -m "feat: fetch confluence root folder metadata"
```

## Task 3: Manifest And Current Project Root Content Types

**Files:**
- Modify: `src/projects/projectManifest.ts`
- Modify: `src/projects/projectManifest.test.ts`
- Modify: `src/settings/defaultSettings.ts`
- Modify: `src/settings/defaultSettings.test.ts`
- Modify: `src/projects/projectStorage.ts`
- Modify: `src/projects/projectStorage.test.ts`

- [ ] **Step 1: Write failing manifest and settings tests**

In `src/projects/projectManifest.test.ts`, add tests for folder paths and manifest fields:

```ts
it("builds folder project paths with a folder-specific stable folder name", () => {
  expect(buildProjectPaths("confluence", "Team Folder", "987654321", "folder")).toEqual({
    projectRootPath: "confluence/confluence-folder-987654321",
    manifestFolderPath: "confluence/confluence-folder-987654321/.confluence-sync",
    manifestPath: "confluence/confluence-folder-987654321/.confluence-sync/manifest.json"
  });
});

it("returns a folder manifest with root content identity", () => {
  const input = {
    projectName: "Team Folder",
    confluenceBaseUrl: "https://example.atlassian.net",
    spaceId: "SPACE",
    rootContentType: "folder" as const,
    rootContentId: "987654321",
    rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
    localFolderPath: "confluence/confluence-folder-987654321",
    createdAt: "2026-04-24T12:34:56.000Z"
  };

  expect(buildProjectManifest(input)).toEqual({
    manifestVersion: 1,
    projectName: "Team Folder",
    confluenceBaseUrl: "https://example.atlassian.net",
    spaceId: "SPACE",
    rootContentType: "folder",
    rootContentId: "987654321",
    rootPageId: "",
    rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
    localRootFolder: "confluence/confluence-folder-987654321",
    localFolderPath: "confluence/confluence-folder-987654321",
    lastPulledAt: null,
    createdAt: "2026-04-24T12:34:56.000Z",
    updatedAt: "2026-04-24T12:34:56.000Z"
  });
});
```

Update the existing page manifest test input to include:

```ts
rootContentType: "page" as const,
rootContentId: "123456789",
```

and update the expected manifest to include:

```ts
rootContentType: "page",
rootContentId: "123456789",
```

In `src/settings/defaultSettings.test.ts`, replace the stored current project test with these two tests:

```ts
it("migrates stored page current project identity when root content fields are missing", async () => {
  const storedSettings = {
    currentProject: {
      projectName: "Current Project",
      spaceId: "SPACE-1",
      rootPageId: "12345",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/pages/12345",
      localFolderPath: "/Users/crobat/vault/confluence/current-project",
      manifestPath: "/Users/crobat/vault/confluence/current-project/.confluence-sync/manifest.json"
    }
  };

  const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

  expect(settings.currentProject).toEqual({
    ...storedSettings.currentProject,
    rootContentType: "page",
    rootContentId: "12345"
  });
});

it("loads stored folder current project identity", async () => {
  const storedSettings = {
    currentProject: {
      projectName: "Team Folder",
      spaceId: "SPACE-1",
      rootContentType: "folder",
      rootContentId: "98765",
      rootPageId: "",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/SPACE-1/folders/98765/Team+Folder",
      localFolderPath: "/Users/crobat/vault/confluence/team-folder",
      manifestPath: "/Users/crobat/vault/confluence/team-folder/.confluence-sync/manifest.json"
    }
  };

  const settings = await loadConfluenceSyncSettings(() => Promise.resolve(storedSettings));

  expect(settings.currentProject).toEqual(storedSettings.currentProject);
});
```

In `src/projects/projectStorage.test.ts`, update `createManifest()` to include:

```ts
rootContentType: "page",
rootContentId: "123456789",
```

Then add:

```ts
it("updates an existing folder manifest when it belongs to the same folder project", async () => {
  const paths: ProjectPaths = {
    projectRootPath: "confluence/confluence-folder-987654321",
    manifestFolderPath: "confluence/confluence-folder-987654321/.confluence-sync",
    manifestPath: "confluence/confluence-folder-987654321/.confluence-sync/manifest.json"
  };
  const manifest: ConfluenceProjectManifest = {
    manifestVersion: 1,
    projectName: "Team Folder",
    confluenceBaseUrl: "https://example.atlassian.net",
    spaceId: "SPACE",
    rootContentType: "folder",
    rootContentId: "987654321",
    rootPageId: "",
    rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
    localRootFolder: "confluence/confluence-folder-987654321",
    localFolderPath: "confluence/confluence-folder-987654321",
    lastPulledAt: null,
    createdAt: "2026-04-24T12:34:56.000Z",
    updatedAt: "2026-04-24T12:34:56.000Z"
  };
  const { calls, storage } = createStorageMock({
    existingPaths: new Set([paths.manifestPath]),
    existingFiles: new Map([[paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`]])
  });

  const result = await writeProjectManifest(storage, paths, { ...manifest, projectName: "Renamed Team Folder" });

  expect(result).toEqual({
    ok: true,
    manifestPath: paths.manifestPath
  });
  expect(calls).toEqual([
    `exists:${paths.manifestPath}`,
    `read:${paths.manifestPath}`,
    `write:${paths.manifestPath}:${JSON.stringify({ ...manifest, projectName: "Renamed Team Folder" }, null, 2)}\n`
  ]);
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm exec vitest run src/projects/projectManifest.test.ts src/settings/defaultSettings.test.ts src/projects/projectStorage.test.ts
```

Expected: FAIL because `rootContentType/rootContentId` and the fourth `buildProjectPaths` parameter do not exist yet.

- [ ] **Step 3: Implement manifest and settings types**

Update `src/projects/projectManifest.ts` with these changes:

```ts
export type RootContentType = "page" | "folder";

export interface ConfluenceProjectManifest {
  manifestVersion: 1;
  projectName: string;
  confluenceBaseUrl: string;
  spaceId: string;
  rootContentType: RootContentType;
  rootContentId: string;
  rootPageId: string;
  rootUrl: string;
  localRootFolder: string;
  localFolderPath: string;
  lastPulledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPaths {
  projectRootPath: string;
  manifestFolderPath: string;
  manifestPath: string;
}

export interface BuildProjectManifestInput {
  projectName: string;
  confluenceBaseUrl: string;
  spaceId: string;
  rootContentType: RootContentType;
  rootContentId: string;
  rootUrl: string;
  localFolderPath: string;
  createdAt: string;
}
```

Change `buildProjectPaths`, `buildProjectManifest`, and the stable folder helper:

```ts
export function buildProjectPaths(
  defaultProjectFolder: string,
  _projectName: string,
  rootContentId: string,
  rootContentType: RootContentType = "page"
): ProjectPaths {
  const normalizedDefaultFolder = normalizeVaultFolderPath(defaultProjectFolder);
  const projectRootPath = joinVaultPath(normalizedDefaultFolder, createStableProjectFolderName(rootContentType, rootContentId));
  const manifestFolderPath = joinVaultPath(projectRootPath, ".confluence-sync");
  const manifestPath = joinVaultPath(manifestFolderPath, "manifest.json");

  return {
    projectRootPath,
    manifestFolderPath,
    manifestPath
  };
}

export function buildProjectManifest(input: BuildProjectManifestInput): ConfluenceProjectManifest {
  // createdAt와 updatedAt을 동일하게 두어 생성 시점이 결정적으로 유지되도록 한다.
  return {
    manifestVersion: 1,
    projectName: input.projectName,
    confluenceBaseUrl: input.confluenceBaseUrl,
    spaceId: input.spaceId,
    rootContentType: input.rootContentType,
    rootContentId: input.rootContentId,
    rootPageId: input.rootContentType === "page" ? input.rootContentId : "",
    rootUrl: input.rootUrl,
    localRootFolder: input.localFolderPath,
    localFolderPath: input.localFolderPath,
    lastPulledAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function createStableProjectFolderName(rootContentType: RootContentType, rootContentId: string): string {
  return `confluence-${rootContentType}-${rootContentId}`;
}
```

Update `src/settings/defaultSettings.ts`:

```ts
import type { RootContentType } from "../projects/projectManifest";

export interface CurrentConfluenceProjectSettings {
  projectName: string;
  spaceId: string;
  rootContentType: RootContentType;
  rootContentId: string;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
  manifestPath: string;
}
```

Replace `loadConfluenceSyncSettings` with:

```ts
export async function loadConfluenceSyncSettings(loadStoredSettings: () => Promise<unknown>): Promise<ConfluenceSyncSettings> {
  try {
    const storedSettings = await loadStoredSettings();
    const mergedSettings = {
      ...DEFAULT_CONFLUENCE_SYNC_SETTINGS,
      ...(isObjectRecord(storedSettings) ? storedSettings : {})
    };

    return {
      ...mergedSettings,
      currentProject: normalizeCurrentProjectSettings(mergedSettings.currentProject)
    };
  } catch {
    return { ...DEFAULT_CONFLUENCE_SYNC_SETTINGS };
  }
}

function normalizeCurrentProjectSettings(
  currentProject: ConfluenceSyncSettings["currentProject"]
): CurrentConfluenceProjectSettings | null {
  if (currentProject === null) {
    return null;
  }

  if (currentProject.rootContentType === "page" || currentProject.rootContentType === "folder") {
    return currentProject;
  }

  return {
    ...currentProject,
    rootContentType: "page",
    rootContentId: currentProject.rootPageId
  };
}
```

- [ ] **Step 4: Implement manifest identity comparison**

Update `src/projects/projectStorage.ts` identity helpers:

```ts
interface ExistingProjectManifestIdentity {
  confluenceBaseUrl: string;
  rootContentType: RootContentType;
  rootContentId: string;
  localRootFolder: string;
}

function parseExistingProjectManifestIdentity(rawManifest: string): ExistingProjectManifestIdentity | null {
  try {
    const parsedManifest = JSON.parse(rawManifest) as Partial<ConfluenceProjectManifest>;

    if (
      typeof parsedManifest.localRootFolder === "string" &&
      typeof parsedManifest.confluenceBaseUrl === "string"
    ) {
      const rootContentType = parsedManifest.rootContentType ?? "page";
      const rootContentId = parsedManifest.rootContentId ?? parsedManifest.rootPageId;

      if (
        (rootContentType === "page" || rootContentType === "folder") &&
        typeof rootContentId === "string"
      ) {
        return {
          confluenceBaseUrl: parsedManifest.confluenceBaseUrl,
          rootContentType,
          rootContentId,
          localRootFolder: parsedManifest.localRootFolder
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isSameProjectManifest(
  existingManifest: ExistingProjectManifestIdentity,
  manifest: ConfluenceProjectManifest
): boolean {
  return (
    existingManifest.confluenceBaseUrl === manifest.confluenceBaseUrl &&
    existingManifest.rootContentType === manifest.rootContentType &&
    existingManifest.rootContentId === manifest.rootContentId &&
    existingManifest.localRootFolder === manifest.localRootFolder
  );
}
```

Add this import at the top:

```ts
import type { ConfluenceProjectManifest, ProjectPaths, RootContentType } from "./projectManifest";
```

- [ ] **Step 5: Run focused tests to verify pass**

Run:

```bash
pnpm exec vitest run src/projects/projectManifest.test.ts src/settings/defaultSettings.test.ts src/projects/projectStorage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit manifest/settings change**

```bash
git add src/projects/projectManifest.ts src/projects/projectManifest.test.ts src/settings/defaultSettings.ts src/settings/defaultSettings.test.ts src/projects/projectStorage.ts src/projects/projectStorage.test.ts
git commit -m "feat: store root content identity in project manifest"
```

## Task 4: Project Creation Flow And UI Copy

**Files:**
- Modify: `src/projects/createProjectFromRootUrl.ts`
- Modify: `src/projects/createProjectFromRootUrl.test.ts`
- Modify: `src/settings/ConfluenceSyncSettingTab.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write failing project creation test**

Add this test to `src/projects/createProjectFromRootUrl.test.ts`:

```ts
it("creates a folder root project from a Confluence folder URL", async () => {
  const settings = createSettings();
  const transport = createTransportMock({
    status: 200,
    json: {
      id: "987654321",
      title: "Team Folder",
      spaceId: "SPACE"
    }
  });
  const storage = createStorageMock();

  const result = await createProjectFromRootUrl({
    settings,
    rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder#children",
    transport: transport.transport,
    storage: storage.storage,
    now: () => new Date("2026-04-24T12:34:56.000Z")
  });

  expect(result).toEqual({
    ok: true,
    message: "Confluence 프로젝트를 생성했습니다: Team Folder",
    currentProject: {
      projectName: "Team Folder",
      spaceId: "SPACE",
      rootContentType: "folder",
      rootContentId: "987654321",
      rootPageId: "",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
      localFolderPath: "confluence/confluence-folder-987654321",
      manifestPath: "confluence/confluence-folder-987654321/.confluence-sync/manifest.json"
    }
  });
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.url).toBe("https://selta.atlassian.net/wiki/api/v2/folders/987654321");

  const writtenManifest = JSON.parse(storage.writeCalls[0]?.data ?? "{}") as Record<string, unknown>;

  expect(writtenManifest).toMatchObject({
    manifestVersion: 1,
    projectName: "Team Folder",
    confluenceBaseUrl: "https://selta.atlassian.net",
    spaceId: "SPACE",
    rootContentType: "folder",
    rootContentId: "987654321",
    rootPageId: "",
    rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
    localRootFolder: "confluence/confluence-folder-987654321",
    localFolderPath: "confluence/confluence-folder-987654321",
    lastPulledAt: null
  });
});
```

Update the existing page project creation expected `currentProject` and written manifest assertions to include:

```ts
rootContentType: "page",
rootContentId: "123456789",
```

- [ ] **Step 2: Run project creation test to verify failure**

Run:

```bash
pnpm exec vitest run src/projects/createProjectFromRootUrl.test.ts
```

Expected: FAIL because the service still calls the page-only parser and page metadata fetcher.

- [ ] **Step 3: Implement root content creation flow**

Update `src/projects/createProjectFromRootUrl.ts` imports:

```ts
import { buildProjectManifest, buildProjectPaths, type RootContentType } from "./projectManifest";
import { getConfluenceApiBaseUrl } from "../confluence/authentication";
import { fetchRootFolderMetadata } from "../confluence/rootFolderMetadata";
import { fetchRootPageMetadata } from "../confluence/rootPageMetadata";
import { parseConfluenceRootUrl } from "../confluence/pageUrl";
```

Add a local metadata type and fetch helper:

```ts
interface RootContentMetadata {
  rootContentType: RootContentType;
  rootContentId: string;
  projectName: string;
  spaceId: string;
}

async function fetchRootContentMetadata(
  input: CreateProjectFromRootUrlInput,
  rootContentType: RootContentType,
  rootContentId: string
): Promise<{ ok: true; metadata: RootContentMetadata } | { ok: false; message: string }> {
  if (rootContentType === "page") {
    const metadataResult = await fetchRootPageMetadata(input.settings, rootContentId, input.transport);

    if (!metadataResult.ok) {
      return buildFailureResult(metadataResult.message);
    }

    return {
      ok: true,
      metadata: {
        rootContentType,
        rootContentId: metadataResult.metadata.pageId,
        projectName: metadataResult.metadata.title,
        spaceId: metadataResult.metadata.spaceId
      }
    };
  }

  const metadataResult = await fetchRootFolderMetadata(input.settings, rootContentId, input.transport);

  if (!metadataResult.ok) {
    return buildFailureResult(metadataResult.message);
  }

  return {
    ok: true,
    metadata: {
      rootContentType,
      rootContentId: metadataResult.metadata.folderId,
      projectName: metadataResult.metadata.title,
      spaceId: metadataResult.metadata.spaceId
    }
  };
}
```

Replace the parser and metadata part of `createProjectFromRootUrl` with:

```ts
const parsedRootUrlResult = parseConfluenceRootUrl(input.rawRootUrl, input.settings.confluenceBaseUrl);

if (!parsedRootUrlResult.ok) {
  return buildFailureResult(parsedRootUrlResult.message);
}

const metadataResult = await fetchRootContentMetadata(
  input,
  parsedRootUrlResult.rootContentType,
  parsedRootUrlResult.rootContentId
);

if (!metadataResult.ok) {
  return buildFailureResult(metadataResult.message);
}
```

Then update path, manifest, and current project creation to use `metadataResult.metadata`:

```ts
paths = buildProjectPaths(
  input.settings.defaultProjectFolder,
  metadataResult.metadata.projectName,
  metadataResult.metadata.rootContentId,
  metadataResult.metadata.rootContentType
);
```

```ts
const manifest = buildProjectManifest({
  projectName: metadataResult.metadata.projectName,
  confluenceBaseUrl: getConfluenceApiBaseUrl(input.settings.confluenceBaseUrl),
  spaceId: metadataResult.metadata.spaceId,
  rootContentType: metadataResult.metadata.rootContentType,
  rootContentId: metadataResult.metadata.rootContentId,
  rootUrl: parsedRootUrlResult.rootUrl,
  localFolderPath: paths.projectRootPath,
  createdAt
});
```

```ts
currentProject: {
  projectName: manifest.projectName,
  spaceId: manifest.spaceId,
  rootContentType: manifest.rootContentType,
  rootContentId: manifest.rootContentId,
  rootPageId: manifest.rootPageId,
  rootUrl: manifest.rootUrl,
  localFolderPath: manifest.localFolderPath,
  manifestPath: writeResult.manifestPath
}
```

- [ ] **Step 4: Update setting UI copy**

In `src/settings/ConfluenceSyncSettingTab.ts`, rename local variable `rootPageUrl` to `rootContentUrl` and update user-facing strings:

```ts
let rootContentUrl = this.plugin.settings.currentProject?.rootUrl ?? "";
```

```ts
text: "루트 페이지 또는 루트 폴더 기반 프로젝트를 생성할 수 있습니다."
```

```ts
.setName("Root content URL")
.setDesc("루트 페이지 또는 루트 폴더 URL로 Confluence 프로젝트를 생성합니다.")
```

```ts
.setPlaceholder("https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root")
.setValue(rootContentUrl)
.onChange((value) => {
  rootContentUrl = value;
});
```

```ts
.setDesc("루트 페이지 또는 폴더 URL을 기반으로 로컬 프로젝트 manifest와 폴더를 생성합니다.")
```

and pass the renamed variable:

```ts
rawRootUrl: rootContentUrl,
```

In `src/main.ts`, update the missing project notice:

```ts
new Notice("Pull Tree 실행 전에 설정 화면에서 루트 콘텐츠 기반 프로젝트를 생성하세요.");
```

- [ ] **Step 5: Run project creation tests to verify pass**

Run:

```bash
pnpm exec vitest run src/projects/createProjectFromRootUrl.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit project creation and UI copy**

```bash
git add src/projects/createProjectFromRootUrl.ts src/projects/createProjectFromRootUrl.test.ts src/settings/ConfluenceSyncSettingTab.ts src/main.ts
git commit -m "feat: create projects from confluence folder roots"
```

## Task 5: Documentation Check And Full Verification

**Files:**
- Modify: `docs/mvp-epics.md`

- [ ] **Step 1: Confirm the implementation plan link in Epic 3 extension**

Confirm `docs/mvp-epics.md` contains this block under `## Epic 3 확장. 루트 폴더 기반 프로젝트 생성`:

```md
### 구현 계획

- [Root Folder Project Creation Implementation Plan](superpowers/plans/2026-04-24-root-folder-project-creation.md)
```

- [ ] **Step 2: Run full verification**

Run:

```bash
rg "Root Folder Project Creation Implementation Plan" docs/mvp-epics.md
```

Expected: one matching link to `superpowers/plans/2026-04-24-root-folder-project-creation.md`.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm run verify
```

Expected: PASS for lint, test, and build.

- [ ] **Step 3: Prepare current vault before UI testing**

Run:

```bash
pnpm run prepare:current-vault
```

Expected: build succeeds and `.obsidian/plugins/confluence-obsidian-sync/main.js` includes the string `Root content URL`.

Then verify the built UI string:

```bash
rg "Root content URL|루트 페이지 또는 루트 폴더 기반 프로젝트" .obsidian/plugins/confluence-obsidian-sync/main.js
```

Expected: both strings are found.

- [ ] **Step 4: Commit documentation link if it is not already committed**

```bash
git add docs/mvp-epics.md
git commit -m "docs: link root folder project creation plan"
```

## Self-Review

- Spec coverage:
  - Folder URL에서 `folderId` 추출: Task 1.
  - 루트 폴더 메타데이터 조회: Task 2.
  - manifest에 `rootContentType/rootContentId` 저장: Task 3.
  - page/folder를 같은 UI에서 생성: Task 4.
  - 이후 Pull에서 folder descendants API를 선택할 수 있는 구분값 제공: Task 3과 Task 4의 `rootContentType`.
- Placeholder scan:
  - 계획에 미완성 작업을 뜻하는 금지 표현 없음.
  - 각 코드 변경 단계는 실제 타입, 함수명, 메시지, 명령을 포함한다.
- Type consistency:
  - `RootContentType`, `rootContentType`, `rootContentId` 명칭을 manifest, settings, creation flow 전반에서 동일하게 사용한다.
  - `rootPageId`는 page 루트에서는 page id, folder 루트에서는 빈 문자열로 유지해 기존 page 기반 코드와 folder 구분을 동시에 만족한다.
