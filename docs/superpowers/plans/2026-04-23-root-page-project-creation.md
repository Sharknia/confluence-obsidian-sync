# Root Page Project Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 Confluence 루트 페이지 URL을 입력하면 루트 페이지 메타데이터를 조회하고 vault 내부 로컬 프로젝트 폴더와 manifest를 생성한다.

**Architecture:** Epic 2의 인증/URL 유틸리티를 재사용하고, Confluence URL 파싱, 루트 페이지 메타데이터 조회, vault 폴더/manifest 생성, Obsidian UI 오케스트레이션을 분리한다. 순수 로직은 Vitest로 검증하고, Obsidian 의존성은 작은 transport/storage 인터페이스로 감싸 테스트 가능하게 유지한다.

**Tech Stack:** TypeScript, Obsidian Plugin API, Atlassian Confluence Cloud REST API v2, Vitest, ESLint, pnpm

---

## Scope

Epic 3의 완료 기준만 구현한다.

- Confluence URL에서 `pageId` 추출
- 루트 페이지 메타데이터 조회
- 프로젝트 이름, `spaceId`, `rootPageId`, `rootUrl` 저장
- vault 내부 로컬 저장 폴더 생성
- 프로젝트 manifest 생성

페이지 트리 Pull, Markdown 변환, 반복 동기화 정책, Push는 Epic 4 이후에서 구현한다. Epic 3에서는 생성된 프로젝트를 현재 프로젝트로 저장하고, Pull Tree 명령은 "다음 Epic에서 구현" 안내를 유지한다.

## External API Notes

- 루트 페이지 메타데이터 조회는 Confluence Cloud REST API v2 `GET /wiki/api/v2/pages/{id}`를 사용한다.
- 응답에서 최소 `id`, `title`, `spaceId`, `version.number`를 읽는다.
- 참고 문서:
  - [Confluence Cloud REST API v2 pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/)
  - [Atlassian Support: How to get Confluence page ID](https://support.atlassian.com/confluence/kb/how-to-get-confluence-page-id/)

## File Structure

- Create: `src/confluence/requestTransport.ts`
  - Confluence API transport 타입을 공유한다.
- Modify: `src/confluence/connectionCheck.ts`
  - 기존 inline transport 타입을 공유 타입 import로 교체한다.
- Create: `src/confluence/pageUrl.ts`
  - Confluence 루트 페이지 URL에서 `pageId`와 정규화된 `rootUrl`을 추출한다.
- Create: `src/confluence/pageUrl.test.ts`
  - `/spaces/.../pages/{id}`, `/pages/viewpage.action?pageId={id}`, base URL 불일치, 누락 오류 테스트
- Create: `src/confluence/rootPageMetadata.ts`
  - `GET /wiki/api/v2/pages/{id}` 호출과 오류 분류
- Create: `src/confluence/rootPageMetadata.test.ts`
  - 성공, 401, 403, 404, 네트워크 오류, 잘못된 응답 테스트
- Create: `src/projects/projectManifest.ts`
  - 프로젝트 manifest 타입, 안전한 폴더명 생성, vault 경로 조합
- Create: `src/projects/projectManifest.test.ts`
  - 폴더명 정리, manifest JSON 생성, vault path traversal 차단 테스트
- Create: `src/projects/projectStorage.ts`
  - vault storage 인터페이스와 manifest 파일 쓰기 로직
- Create: `src/projects/projectStorage.test.ts`
  - 폴더 생성 순서, 중복 manifest 차단, JSON write 테스트
- Create: `src/projects/createProjectFromRootUrl.ts`
  - URL 파싱, 메타데이터 조회, manifest 생성, 현재 프로젝트 설정 업데이트를 묶는 유스케이스
- Create: `src/projects/createProjectFromRootUrl.test.ts`
  - 성공 플로우와 주요 실패 플로우 테스트
- Modify: `src/settings/defaultSettings.ts`
  - 현재 프로젝트 설정 타입과 기본값 확장
- Modify: `src/settings/defaultSettings.test.ts`
  - 저장된 현재 프로젝트 설정 로드 테스트
- Modify: `src/settings/ConfluenceSyncSettingTab.ts`
  - 루트 페이지 URL 입력과 "Create project" 버튼 추가
- Modify: `src/main.ts`
  - Pull Tree 안내에 현재 프로젝트 유무 검증 추가
- Modify: `docs/mvp-epics.md`
  - Epic 3 구현 계획 링크 추가

## Task 1: Confluence API transport 타입 공유

**Files:**
- Create: `src/confluence/requestTransport.ts`
- Modify: `src/confluence/connectionCheck.ts`

- [ ] **Step 1: Create shared transport type**

Create `src/confluence/requestTransport.ts`:

```typescript
import type { RequestUrlParam } from "obsidian";

export interface ConfluenceRequestResult {
  status: number;
  json: unknown;
}

export type ConfluenceRequestTransport = (request: RequestUrlParam) => Promise<ConfluenceRequestResult>;
```

- [ ] **Step 2: Replace inline transport types in connection check**

Modify `src/confluence/connectionCheck.ts`:

```typescript
import {
  buildBasicAuthorizationHeader,
  buildConfluenceApiUrl,
  getMissingConfluenceConnectionFields
} from "./authentication";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export type ConfluenceConnectionFailureReason =
  | "missing-settings"
  | "authentication-failed"
  | "permission-denied"
  | "network-error"
  | "api-error";

export interface ConfluenceConnectionSuccess {
  ok: true;
  accountId: string;
  displayName: string;
  message: string;
}

export interface ConfluenceConnectionFailure {
  ok: false;
  reason: ConfluenceConnectionFailureReason;
  message: string;
}

export type ConfluenceConnectionResult = ConfluenceConnectionSuccess | ConfluenceConnectionFailure;

interface CurrentUserResponse {
  accountId?: unknown;
  displayName?: unknown;
}

function getResponseMessage(status: number): string {
  return `Confluence API 오류가 발생했습니다. HTTP ${status}`;
}

function getCurrentUserResponseDetails(responseBody: unknown): { accountId: string; displayName: string } | null {
  if (typeof responseBody !== "object" || responseBody === null) {
    return null;
  }

  const currentUser = responseBody as CurrentUserResponse;

  if (typeof currentUser.accountId !== "string" || typeof currentUser.displayName !== "string") {
    return null;
  }

  return {
    accountId: currentUser.accountId,
    displayName: currentUser.displayName
  };
}

export async function checkConfluenceConnection(
  settings: ConfluenceSyncSettings,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceConnectionResult> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: "missing-settings",
      message: `Confluence 연결 설정이 필요합니다: ${missingFields.join(", ")}`
    };
  }

  let response: ConfluenceRequestResult;

  try {
    response = await transport({
      url: buildConfluenceApiUrl(settings.confluenceBaseUrl, "/wiki/rest/api/user/current"),
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken)
      }
    });
  } catch {
    return {
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence에 연결할 수 없습니다. 인터넷 연결과 base URL을 확인하세요."
    };
  }

  if (response.status === 200) {
    const userDetails = getCurrentUserResponseDetails(response.json);

    if (userDetails === null) {
      return {
        ok: false,
        reason: "api-error",
        message: getResponseMessage(response.status)
      };
    }

    return {
      ok: true,
      accountId: userDetails.accountId,
      displayName: userDetails.displayName,
      message: `Confluence 연결에 성공했습니다: ${userDetails.displayName}`
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    };
  }

  if (response.status === 403) {
    return {
      ok: false,
      reason: "permission-denied",
      message: "Confluence 접근 권한이 없습니다. 계정의 Confluence 권한을 확인하세요."
    };
  }

  return {
    ok: false,
    reason: "api-error",
    message: getResponseMessage(response.status)
  };
}
```

- [ ] **Step 3: Run existing connection tests**

Run:

```bash
pnpm exec vitest run src/confluence/connectionCheck.test.ts
```

Expected:

```text
PASS  src/confluence/connectionCheck.test.ts
```

- [ ] **Step 4: Commit**

Run:

```bash
git add src/confluence/requestTransport.ts src/confluence/connectionCheck.ts
git commit -m "refactor: Confluence 요청 transport 타입 공유"
```

## Task 2: Confluence 루트 페이지 URL 파싱

**Files:**
- Create: `src/confluence/pageUrl.ts`
- Create: `src/confluence/pageUrl.test.ts`

- [ ] **Step 1: Write failing URL parser tests**

Create `src/confluence/pageUrl.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseConfluencePageUrl } from "./pageUrl";

describe("parseConfluencePageUrl", () => {
  it("extracts pageId from a modern Confluence Cloud page URL", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: true,
      pageId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root"
    });
  });

  it("extracts pageId from a viewpage.action URL", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321",
      "https://selta.atlassian.net/"
    );

    expect(result).toEqual({
      ok: true,
      pageId: "987654321",
      rootUrl: "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321"
    });
  });

  it("rejects URLs outside the configured Confluence base URL", () => {
    const result = parseConfluencePageUrl(
      "https://other.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "base-url-mismatch",
      message: "입력한 URL이 설정된 Confluence base URL과 일치하지 않습니다."
    });
  });

  it("rejects URLs without a pageId", () => {
    const result = parseConfluencePageUrl("https://selta.atlassian.net/wiki/spaces/DEV/overview", "https://selta.atlassian.net");

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("rejects invalid URL text", () => {
    const result = parseConfluencePageUrl("not a url", "https://selta.atlassian.net");

    expect(result).toEqual({
      ok: false,
      reason: "invalid-url",
      message: "올바른 Confluence 페이지 URL을 입력하세요."
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/confluence/pageUrl.test.ts
```

Expected:

```text
FAIL  src/confluence/pageUrl.test.ts
Error: Failed to resolve import "./pageUrl"
```

- [ ] **Step 3: Implement URL parser**

Create `src/confluence/pageUrl.ts`:

```typescript
import { normalizeConfluenceBaseUrl } from "../settings/defaultSettings";

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

function extractPageIdFromUrl(url: URL): string | null {
  const pageIdFromQuery = url.searchParams.get("pageId");

  if (pageIdFromQuery !== null && /^\d+$/u.test(pageIdFromQuery)) {
    return pageIdFromQuery;
  }

  const pagePathMatch = url.pathname.match(/\/pages\/(\d+)(?:\/|$)/u);

  if (pagePathMatch?.[1] !== undefined) {
    return pagePathMatch[1];
  }

  return null;
}

function buildNormalizedRootUrl(url: URL): string {
  // 브라우저 공유 URL의 hash는 pageId 식별에 필요하지 않으므로 저장하지 않는다.
  return `${url.origin}${url.pathname}${url.search}`;
}

export function parseConfluencePageUrl(rawRootUrl: string, rawBaseUrl: string): ConfluencePageUrlParseResult {
  let rootUrl: URL;
  let baseUrl: URL;

  try {
    rootUrl = new URL(rawRootUrl.trim());
    baseUrl = new URL(normalizeConfluenceBaseUrl(rawBaseUrl));
  } catch {
    return {
      ok: false,
      reason: "invalid-url",
      message: "올바른 Confluence 페이지 URL을 입력하세요."
    };
  }

  if (rootUrl.origin !== baseUrl.origin) {
    return {
      ok: false,
      reason: "base-url-mismatch",
      message: "입력한 URL이 설정된 Confluence base URL과 일치하지 않습니다."
    };
  }

  const pageId = extractPageIdFromUrl(rootUrl);

  if (pageId === null) {
    return {
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    };
  }

  return {
    ok: true,
    pageId,
    rootUrl: buildNormalizedRootUrl(rootUrl)
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/confluence/pageUrl.test.ts
```

Expected:

```text
PASS  src/confluence/pageUrl.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/confluence/pageUrl.ts src/confluence/pageUrl.test.ts
git commit -m "feat: Confluence 페이지 URL에서 pageId 추출"
```

## Task 3: 루트 페이지 메타데이터 조회

**Files:**
- Create: `src/confluence/rootPageMetadata.ts`
- Create: `src/confluence/rootPageMetadata.test.ts`

- [ ] **Step 1: Write failing metadata client tests**

Create `src/confluence/rootPageMetadata.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { fetchRootPageMetadata } from "./rootPageMetadata";
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
  return async () => response;
}

describe("fetchRootPageMetadata", () => {
  it("returns root page metadata from Confluence API v2", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "123456789",
      createTransport({
        status: 200,
        json: {
          id: "123456789",
          title: "Project Root",
          spaceId: "SPACE-1",
          version: {
            number: 7
          }
        }
      })
    );

    expect(result).toEqual({
      ok: true,
      metadata: {
        pageId: "123456789",
        title: "Project Root",
        spaceId: "SPACE-1",
        versionNumber: 7
      }
    });
  });

  it("sends the expected authenticated request", async () => {
    const requests: unknown[] = [];
    const transport: ConfluenceRequestTransport = async (request) => {
      requests.push(request);
      return {
        status: 200,
        json: {
          id: "123456789",
          title: "Project Root",
          spaceId: "SPACE-1",
          version: {
            number: 1
          }
        }
      };
    };

    await fetchRootPageMetadata(createSettings(), "123456789", transport);

    expect(requests).toEqual([
      {
        url: "https://selta.atlassian.net/wiki/api/v2/pages/123456789",
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu"
        }
      }
    ]);
  });

  it("returns not-found for HTTP 404", async () => {
    const result = await fetchRootPageMetadata(createSettings(), "123456789", createTransport({ status: 404, json: {} }));

    expect(result).toEqual({
      ok: false,
      reason: "not-found",
      message: "루트 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    });
  });

  it("returns permission-denied for HTTP 403", async () => {
    const result = await fetchRootPageMetadata(createSettings(), "123456789", createTransport({ status: 403, json: {} }));

    expect(result).toEqual({
      ok: false,
      reason: "permission-denied",
      message: "루트 페이지에 접근할 권한이 없습니다."
    });
  });

  it("returns invalid-response when required fields are missing", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "123456789",
      createTransport({
        status: 200,
        json: {
          id: "123456789",
          title: "Project Root"
        }
      })
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence 루트 페이지 응답 형식이 올바르지 않습니다."
    });
  });

  it("returns network-error when transport throws", async () => {
    const transport: ConfluenceRequestTransport = async () => {
      throw new Error("offline");
    };

    const result = await fetchRootPageMetadata(createSettings(), "123456789", transport);

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 루트 페이지 메타데이터를 조회할 수 없습니다."
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/confluence/rootPageMetadata.test.ts
```

Expected:

```text
FAIL  src/confluence/rootPageMetadata.test.ts
Error: Failed to resolve import "./rootPageMetadata"
```

- [ ] **Step 3: Implement metadata client**

Create `src/confluence/rootPageMetadata.ts`:

```typescript
import { buildBasicAuthorizationHeader, buildConfluenceApiUrl } from "./authentication";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export interface RootPageMetadata {
  pageId: string;
  title: string;
  spaceId: string;
  versionNumber: number;
}

export type RootPageMetadataFailureReason =
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "network-error"
  | "invalid-response"
  | "api-error";

export interface RootPageMetadataSuccess {
  ok: true;
  metadata: RootPageMetadata;
}

export interface RootPageMetadataFailure {
  ok: false;
  reason: RootPageMetadataFailureReason;
  message: string;
}

export type RootPageMetadataResult = RootPageMetadataSuccess | RootPageMetadataFailure;

interface ConfluencePageResponse {
  id?: unknown;
  title?: unknown;
  spaceId?: unknown;
  version?: {
    number?: unknown;
  };
}

function parseRootPageMetadata(responseBody: unknown): RootPageMetadata | null {
  if (typeof responseBody !== "object" || responseBody === null) {
    return null;
  }

  const page = responseBody as ConfluencePageResponse;

  if (
    typeof page.id !== "string" ||
    typeof page.title !== "string" ||
    typeof page.spaceId !== "string" ||
    typeof page.version?.number !== "number"
  ) {
    return null;
  }

  return {
    pageId: page.id,
    title: page.title,
    spaceId: page.spaceId,
    versionNumber: page.version.number
  };
}

function mapFailureResponse(response: ConfluenceRequestResult): RootPageMetadataFailure {
  if (response.status === 401) {
    return {
      ok: false,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    };
  }

  if (response.status === 403) {
    return {
      ok: false,
      reason: "permission-denied",
      message: "루트 페이지에 접근할 권한이 없습니다."
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: "not-found",
      message: "루트 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    };
  }

  return {
    ok: false,
    reason: "api-error",
    message: `루트 페이지 메타데이터 조회 중 Confluence API 오류가 발생했습니다. HTTP ${response.status}`
  };
}

export async function fetchRootPageMetadata(
  settings: ConfluenceSyncSettings,
  pageId: string,
  transport: ConfluenceRequestTransport
): Promise<RootPageMetadataResult> {
  let response: ConfluenceRequestResult;

  try {
    response = await transport({
      url: buildConfluenceApiUrl(settings.confluenceBaseUrl, `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`),
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken)
      }
    });
  } catch {
    return {
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 루트 페이지 메타데이터를 조회할 수 없습니다."
    };
  }

  if (response.status !== 200) {
    return mapFailureResponse(response);
  }

  const metadata = parseRootPageMetadata(response.json);

  if (metadata === null) {
    return {
      ok: false,
      reason: "invalid-response",
      message: "Confluence 루트 페이지 응답 형식이 올바르지 않습니다."
    };
  }

  return {
    ok: true,
    metadata
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/confluence/rootPageMetadata.test.ts
```

Expected:

```text
PASS  src/confluence/rootPageMetadata.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/confluence/rootPageMetadata.ts src/confluence/rootPageMetadata.test.ts
git commit -m "feat: Confluence 루트 페이지 메타데이터 조회"
```

## Task 4: 프로젝트 manifest와 vault 경로 규칙

**Files:**
- Create: `src/projects/projectManifest.ts`
- Create: `src/projects/projectManifest.test.ts`

- [ ] **Step 1: Write failing manifest tests**

Create `src/projects/projectManifest.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildProjectManifest,
  buildProjectPaths,
  createSafeProjectFolderName,
  normalizeVaultFolderPath
} from "./projectManifest";

describe("createSafeProjectFolderName", () => {
  it("removes characters that are unsafe in file names", () => {
    expect(createSafeProjectFolderName("Team: API / Sync? <Root>*")).toBe("Team API Sync Root");
  });

  it("falls back to the page id when the title has no usable characters", () => {
    expect(createSafeProjectFolderName("///", "123456789")).toBe("confluence-page-123456789");
  });
});

describe("normalizeVaultFolderPath", () => {
  it("normalizes slashes around vault folder paths", () => {
    expect(normalizeVaultFolderPath("/confluence/projects/")).toBe("confluence/projects");
  });

  it("rejects path traversal", () => {
    expect(() => normalizeVaultFolderPath("../outside")).toThrow("vault 폴더 경로에는 '..'을 사용할 수 없습니다.");
  });
});

describe("buildProjectPaths", () => {
  it("builds project root and manifest paths under the default project folder", () => {
    expect(buildProjectPaths("confluence", "Project Root", "123456789")).toEqual({
      projectRootPath: "confluence/Project Root",
      manifestFolderPath: "confluence/Project Root/.confluence-sync",
      manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
    });
  });
});

describe("buildProjectManifest", () => {
  it("creates deterministic manifest content", () => {
    expect(
      buildProjectManifest({
        projectName: "Project Root",
        spaceId: "SPACE-1",
        rootPageId: "123456789",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
        localFolderPath: "confluence/Project Root",
        createdAt: "2026-04-23T00:00:00.000Z"
      })
    ).toEqual({
      manifestVersion: 1,
      projectName: "Project Root",
      spaceId: "SPACE-1",
      rootPageId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localFolderPath: "confluence/Project Root",
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z"
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/projects/projectManifest.test.ts
```

Expected:

```text
FAIL  src/projects/projectManifest.test.ts
Error: Failed to resolve import "./projectManifest"
```

- [ ] **Step 3: Implement manifest helpers**

Create `src/projects/projectManifest.ts`:

```typescript
export interface ConfluenceProjectManifest {
  manifestVersion: 1;
  projectName: string;
  spaceId: string;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
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
  spaceId: string;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
  createdAt: string;
}

function joinVaultPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}

export function normalizeVaultFolderPath(rawFolderPath: string): string {
  const normalizedPath = rawFolderPath.trim().replace(/^\/+|\/+$/gu, "").replace(/\/+/gu, "/");

  if (normalizedPath.length === 0) {
    return "confluence";
  }

  if (normalizedPath.split("/").includes("..")) {
    throw new Error("vault 폴더 경로에는 '..'을 사용할 수 없습니다.");
  }

  return normalizedPath;
}

export function createSafeProjectFolderName(title: string, fallbackPageId = "unknown"): string {
  const safeName = title
    .replace(/[<>:"/\\|?*]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (safeName.length === 0) {
    return `confluence-page-${fallbackPageId}`;
  }

  return safeName;
}

export function buildProjectPaths(defaultProjectFolder: string, projectName: string, rootPageId: string): ProjectPaths {
  const projectFolderName = createSafeProjectFolderName(projectName, rootPageId);
  const projectRootPath = joinVaultPath(normalizeVaultFolderPath(defaultProjectFolder), projectFolderName);
  const manifestFolderPath = joinVaultPath(projectRootPath, ".confluence-sync");

  return {
    projectRootPath,
    manifestFolderPath,
    manifestPath: joinVaultPath(manifestFolderPath, "manifest.json")
  };
}

export function buildProjectManifest(input: BuildProjectManifestInput): ConfluenceProjectManifest {
  return {
    manifestVersion: 1,
    projectName: input.projectName,
    spaceId: input.spaceId,
    rootPageId: input.rootPageId,
    rootUrl: input.rootUrl,
    localFolderPath: input.localFolderPath,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/projects/projectManifest.test.ts
```

Expected:

```text
PASS  src/projects/projectManifest.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/projects/projectManifest.ts src/projects/projectManifest.test.ts
git commit -m "feat: Confluence 프로젝트 manifest 모델 추가"
```

## Task 5: vault 폴더 생성과 manifest 쓰기

**Files:**
- Create: `src/projects/projectStorage.ts`
- Create: `src/projects/projectStorage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `src/projects/projectStorage.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { writeProjectManifest, type ProjectStorageAdapter } from "./projectStorage";
import type { ConfluenceProjectManifest } from "./projectManifest";

function createManifest(): ConfluenceProjectManifest {
  return {
    manifestVersion: 1,
    projectName: "Project Root",
    spaceId: "SPACE-1",
    rootPageId: "123456789",
    rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
    localFolderPath: "confluence/Project Root",
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z"
  };
}

describe("writeProjectManifest", () => {
  it("creates project folders and writes formatted JSON", async () => {
    const calls: string[] = [];
    const existingPaths = new Set<string>();
    const storage: ProjectStorageAdapter = {
      exists: async (path) => existingPaths.has(path),
      mkdir: async (path) => {
        calls.push(`mkdir:${path}`);
        existingPaths.add(path);
      },
      write: async (path, data) => {
        calls.push(`write:${path}:${data}`);
        existingPaths.add(path);
      }
    };

    const result = await writeProjectManifest(
      storage,
      {
        projectRootPath: "confluence/Project Root",
        manifestFolderPath: "confluence/Project Root/.confluence-sync",
        manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
      },
      createManifest()
    );

    expect(result).toEqual({
      ok: true,
      manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
    });
    expect(calls).toEqual([
      "mkdir:confluence/Project Root",
      "mkdir:confluence/Project Root/.confluence-sync",
      `write:confluence/Project Root/.confluence-sync/manifest.json:${JSON.stringify(createManifest(), null, 2)}\n`
    ]);
  });

  it("does not overwrite an existing manifest", async () => {
    const storage: ProjectStorageAdapter = {
      exists: async (path) => path === "confluence/Project Root/.confluence-sync/manifest.json",
      mkdir: async () => {
        throw new Error("mkdir should not run");
      },
      write: async () => {
        throw new Error("write should not run");
      }
    };

    const result = await writeProjectManifest(
      storage,
      {
        projectRootPath: "confluence/Project Root",
        manifestFolderPath: "confluence/Project Root/.confluence-sync",
        manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
      },
      createManifest()
    );

    expect(result).toEqual({
      ok: false,
      reason: "manifest-already-exists",
      message: "이미 프로젝트 manifest가 존재합니다. 기존 프로젝트를 덮어쓰지 않습니다."
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/projects/projectStorage.test.ts
```

Expected:

```text
FAIL  src/projects/projectStorage.test.ts
Error: Failed to resolve import "./projectStorage"
```

- [ ] **Step 3: Implement storage writer**

Create `src/projects/projectStorage.ts`:

```typescript
import type { ConfluenceProjectManifest, ProjectPaths } from "./projectManifest";

export interface ProjectStorageAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
}

export interface WriteProjectManifestSuccess {
  ok: true;
  manifestPath: string;
}

export interface WriteProjectManifestFailure {
  ok: false;
  reason: "manifest-already-exists" | "storage-error";
  message: string;
}

export type WriteProjectManifestResult = WriteProjectManifestSuccess | WriteProjectManifestFailure;

async function ensureFolder(storage: ProjectStorageAdapter, folderPath: string): Promise<void> {
  if (!(await storage.exists(folderPath))) {
    await storage.mkdir(folderPath);
  }
}

export async function writeProjectManifest(
  storage: ProjectStorageAdapter,
  paths: ProjectPaths,
  manifest: ConfluenceProjectManifest
): Promise<WriteProjectManifestResult> {
  try {
    if (await storage.exists(paths.manifestPath)) {
      return {
        ok: false,
        reason: "manifest-already-exists",
        message: "이미 프로젝트 manifest가 존재합니다. 기존 프로젝트를 덮어쓰지 않습니다."
      };
    }

    await ensureFolder(storage, paths.projectRootPath);
    await ensureFolder(storage, paths.manifestFolderPath);
    await storage.write(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    return {
      ok: true,
      manifestPath: paths.manifestPath
    };
  } catch {
    return {
      ok: false,
      reason: "storage-error",
      message: "로컬 프로젝트 폴더 또는 manifest를 생성할 수 없습니다."
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/projects/projectStorage.test.ts
```

Expected:

```text
PASS  src/projects/projectStorage.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/projects/projectStorage.ts src/projects/projectStorage.test.ts
git commit -m "feat: vault 프로젝트 폴더와 manifest 생성"
```

## Task 6: 현재 프로젝트 설정 저장 모델

**Files:**
- Modify: `src/settings/defaultSettings.ts`
- Modify: `src/settings/defaultSettings.test.ts`

- [ ] **Step 1: Add failing settings test**

Modify `src/settings/defaultSettings.test.ts` and add this test inside `describe("loadConfluenceSyncSettings", ...)`:

```typescript
  it("loads the current project setting when stored", async () => {
    const settings = await loadConfluenceSyncSettings(async () => ({
      currentProject: {
        projectName: "Project Root",
        spaceId: "SPACE-1",
        rootPageId: "123456789",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
        localFolderPath: "confluence/Project Root",
        manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
      }
    }));

    expect(settings.currentProject).toEqual({
      projectName: "Project Root",
      spaceId: "SPACE-1",
      rootPageId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localFolderPath: "confluence/Project Root",
      manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/settings/defaultSettings.test.ts
```

Expected:

```text
FAIL  src/settings/defaultSettings.test.ts
AssertionError: expected undefined to deeply equal ...
```

- [ ] **Step 3: Extend settings types and defaults**

Modify `src/settings/defaultSettings.ts`:

```typescript
export interface CurrentConfluenceProjectSettings {
  projectName: string;
  spaceId: string;
  rootPageId: string;
  rootUrl: string;
  localFolderPath: string;
  manifestPath: string;
}

export interface ConfluenceSyncSettings {
  confluenceBaseUrl: string;
  userEmail: string;
  apiToken: string;
  defaultProjectFolder: string;
  safeDeleteFolder: string;
  currentProject: CurrentConfluenceProjectSettings | null;
}

export const DEFAULT_CONFLUENCE_BASE_URL = "https://selta.atlassian.net";

export const DEFAULT_CONFLUENCE_SYNC_SETTINGS: ConfluenceSyncSettings = {
  confluenceBaseUrl: DEFAULT_CONFLUENCE_BASE_URL,
  userEmail: "",
  apiToken: "",
  defaultProjectFolder: "confluence",
  safeDeleteFolder: ".confluence-sync/trash",
  currentProject: null
};

export async function loadConfluenceSyncSettings(loadStoredSettings: () => Promise<unknown>): Promise<ConfluenceSyncSettings> {
  try {
    const storedSettings = await loadStoredSettings();
    return {
      ...DEFAULT_CONFLUENCE_SYNC_SETTINGS,
      ...(isObjectRecord(storedSettings) ? storedSettings : {})
    };
  } catch {
    return { ...DEFAULT_CONFLUENCE_SYNC_SETTINGS };
  }
}

export function normalizeConfluenceBaseUrl(rawBaseUrl: string): string {
  const trimmedBaseUrl = rawBaseUrl.trim();

  if (trimmedBaseUrl.length === 0) {
    return DEFAULT_CONFLUENCE_BASE_URL;
  }

  return trimmedBaseUrl.replace(/\/+$/u, "");
}

function isObjectRecord(value: unknown): value is Partial<ConfluenceSyncSettings> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Update test helpers that construct settings**

Modify these files so each `createSettings()` test helper includes `currentProject: null`:

```text
src/confluence/authentication.test.ts
src/confluence/connectionCheck.test.ts
src/confluence/rootPageMetadata.test.ts
```

Example object:

```typescript
return {
  confluenceBaseUrl: "https://selta.atlassian.net",
  userEmail: "owner@example.com",
  apiToken: "secret-token",
  defaultProjectFolder: "confluence",
  safeDeleteFolder: ".confluence-sync/trash",
  currentProject: null,
  ...overrides
};
```

- [ ] **Step 5: Run affected tests**

Run:

```bash
pnpm exec vitest run src/settings/defaultSettings.test.ts src/confluence/authentication.test.ts src/confluence/connectionCheck.test.ts src/confluence/rootPageMetadata.test.ts
```

Expected:

```text
PASS  src/settings/defaultSettings.test.ts
PASS  src/confluence/authentication.test.ts
PASS  src/confluence/connectionCheck.test.ts
PASS  src/confluence/rootPageMetadata.test.ts
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/settings/defaultSettings.ts src/settings/defaultSettings.test.ts src/confluence/authentication.test.ts src/confluence/connectionCheck.test.ts src/confluence/rootPageMetadata.test.ts
git commit -m "feat: 현재 Confluence 프로젝트 설정 저장"
```

## Task 7: 루트 URL 기반 프로젝트 생성 유스케이스

**Files:**
- Create: `src/projects/createProjectFromRootUrl.ts`
- Create: `src/projects/createProjectFromRootUrl.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Create `src/projects/createProjectFromRootUrl.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createProjectFromRootUrl } from "./createProjectFromRootUrl";
import type { ProjectStorageAdapter } from "./projectStorage";
import type { ConfluenceRequestTransport } from "../confluence/requestTransport";
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

function createStorage(): ProjectStorageAdapter {
  const existingPaths = new Set<string>();

  return {
    exists: async (path) => existingPaths.has(path),
    mkdir: async (path) => {
      existingPaths.add(path);
    },
    write: async (path) => {
      existingPaths.add(path);
    }
  };
}

describe("createProjectFromRootUrl", () => {
  it("creates a project manifest and returns settings for the current project", async () => {
    const transport: ConfluenceRequestTransport = async () => ({
      status: 200,
      json: {
        id: "123456789",
        title: "Project Root",
        spaceId: "SPACE-1",
        version: {
          number: 3
        }
      }
    });

    const result = await createProjectFromRootUrl({
      settings: createSettings(),
      rawRootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root#comment-1",
      transport,
      storage: createStorage(),
      now: () => new Date("2026-04-23T00:00:00.000Z")
    });

    expect(result).toEqual({
      ok: true,
      message: "Confluence 프로젝트를 생성했습니다: Project Root",
      currentProject: {
        projectName: "Project Root",
        spaceId: "SPACE-1",
        rootPageId: "123456789",
        rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
        localFolderPath: "confluence/Project Root",
        manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
      }
    });
  });

  it("returns URL parser failures without calling Confluence", async () => {
    let called = false;
    const transport: ConfluenceRequestTransport = async () => {
      called = true;
      return { status: 200, json: {} };
    };

    const result = await createProjectFromRootUrl({
      settings: createSettings(),
      rawRootUrl: "not a url",
      transport,
      storage: createStorage(),
      now: () => new Date("2026-04-23T00:00:00.000Z")
    });

    expect(result).toEqual({
      ok: false,
      message: "올바른 Confluence 페이지 URL을 입력하세요."
    });
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/projects/createProjectFromRootUrl.test.ts
```

Expected:

```text
FAIL  src/projects/createProjectFromRootUrl.test.ts
Error: Failed to resolve import "./createProjectFromRootUrl"
```

- [ ] **Step 3: Implement project creation use case**

Create `src/projects/createProjectFromRootUrl.ts`:

```typescript
import { parseConfluencePageUrl } from "../confluence/pageUrl";
import type { ConfluenceRequestTransport } from "../confluence/requestTransport";
import { fetchRootPageMetadata } from "../confluence/rootPageMetadata";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";
import { buildProjectManifest, buildProjectPaths } from "./projectManifest";
import { writeProjectManifest, type ProjectStorageAdapter } from "./projectStorage";

export interface CreateProjectFromRootUrlInput {
  settings: ConfluenceSyncSettings;
  rawRootUrl: string;
  transport: ConfluenceRequestTransport;
  storage: ProjectStorageAdapter;
  now: () => Date;
}

export interface CreateProjectFromRootUrlSuccess {
  ok: true;
  message: string;
  currentProject: CurrentConfluenceProjectSettings;
}

export interface CreateProjectFromRootUrlFailure {
  ok: false;
  message: string;
}

export type CreateProjectFromRootUrlResult = CreateProjectFromRootUrlSuccess | CreateProjectFromRootUrlFailure;

export async function createProjectFromRootUrl(input: CreateProjectFromRootUrlInput): Promise<CreateProjectFromRootUrlResult> {
  const pageUrlResult = parseConfluencePageUrl(input.rawRootUrl, input.settings.confluenceBaseUrl);

  if (!pageUrlResult.ok) {
    return {
      ok: false,
      message: pageUrlResult.message
    };
  }

  const metadataResult = await fetchRootPageMetadata(input.settings, pageUrlResult.pageId, input.transport);

  if (!metadataResult.ok) {
    return {
      ok: false,
      message: metadataResult.message
    };
  }

  const paths = buildProjectPaths(input.settings.defaultProjectFolder, metadataResult.metadata.title, metadataResult.metadata.pageId);
  const createdAt = input.now().toISOString();
  const manifest = buildProjectManifest({
    projectName: metadataResult.metadata.title,
    spaceId: metadataResult.metadata.spaceId,
    rootPageId: metadataResult.metadata.pageId,
    rootUrl: pageUrlResult.rootUrl,
    localFolderPath: paths.projectRootPath,
    createdAt
  });
  const writeResult = await writeProjectManifest(input.storage, paths, manifest);

  if (!writeResult.ok) {
    return {
      ok: false,
      message: writeResult.message
    };
  }

  return {
    ok: true,
    message: `Confluence 프로젝트를 생성했습니다: ${manifest.projectName}`,
    currentProject: {
      projectName: manifest.projectName,
      spaceId: manifest.spaceId,
      rootPageId: manifest.rootPageId,
      rootUrl: manifest.rootUrl,
      localFolderPath: manifest.localFolderPath,
      manifestPath: writeResult.manifestPath
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/projects/createProjectFromRootUrl.test.ts
```

Expected:

```text
PASS  src/projects/createProjectFromRootUrl.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add src/projects/createProjectFromRootUrl.ts src/projects/createProjectFromRootUrl.test.ts
git commit -m "feat: 루트 URL 기반 프로젝트 생성 유스케이스 추가"
```

## Task 8: Obsidian 설정 화면과 명령 연결

**Files:**
- Modify: `src/settings/ConfluenceSyncSettingTab.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add Create project UI to settings tab**

Modify `src/settings/ConfluenceSyncSettingTab.ts`:

```typescript
import { Notice, PluginSettingTab, requestUrl, Setting } from "obsidian";
import { checkConfluenceConnection } from "../confluence/connectionCheck";
import { createProjectFromRootUrl } from "../projects/createProjectFromRootUrl";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import type ConfluenceObsidianSyncPlugin from "../main";
import { normalizeConfluenceBaseUrl } from "./defaultSettings";

function createVaultStorageAdapter(plugin: ConfluenceObsidianSyncPlugin): ProjectStorageAdapter {
  return {
    exists: (path) => plugin.app.vault.adapter.exists(path),
    mkdir: (path) => plugin.app.vault.adapter.mkdir(path),
    write: (path, data) => plugin.app.vault.adapter.write(path, data)
  };
}

export class ConfluenceSyncSettingTab extends PluginSettingTab {
  private rootPageUrlInput = "";

  constructor(private readonly plugin: ConfluenceObsidianSyncPlugin) {
    super(plugin.app, plugin);
    this.rootPageUrlInput = plugin.settings.currentProject?.rootUrl ?? "";
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Confluence Obsidian Sync" });
    containerEl.createEl("p", {
      cls: "confluence-sync-setting-description",
      text: "Confluence Cloud 문서를 Obsidian vault 안의 로컬 Markdown 작업 사본으로 가져오기 위한 기본 설정입니다."
    });

    new Setting(containerEl)
      .setName("Confluence base URL")
      .setDesc("예: https://selta.atlassian.net")
      .addText((text) => {
        text
          .setPlaceholder("https://selta.atlassian.net")
          .setValue(this.plugin.settings.confluenceBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.confluenceBaseUrl = normalizeConfluenceBaseUrl(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Atlassian account email")
      .setDesc("Confluence Cloud API token을 발급한 Atlassian 계정 이메일입니다.")
      .addText((text) => {
        text
          .setPlaceholder("name@example.com")
          .setValue(this.plugin.settings.userEmail)
          .onChange(async (value) => {
            this.plugin.settings.userEmail = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("API token")
      .setDesc("MVP에서는 Obsidian 플러그인 설정에 저장합니다. 사내 배포 시 개인 vault 데이터로 취급합니다.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Atlassian API token")
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = value;
            await this.plugin.saveSettings();
          });
      });

    const connectionStatusEl = containerEl.createEl("p", {
      cls: "confluence-sync-connection-status",
      text: "저장된 인증 정보로 Confluence API 접근 여부를 확인할 수 있습니다."
    });

    new Setting(containerEl)
      .setName("Check connection")
      .setDesc("현재 설정으로 Confluence Cloud 현재 사용자 API를 호출합니다.")
      .addButton((button) => {
        button.setButtonText("Check connection").onClick(async () => {
          button.setDisabled(true);
          connectionStatusEl.setText("Confluence 연결을 확인하는 중입니다...");

          try {
            const result = await checkConfluenceConnection(this.plugin.settings, async (request) => {
              const response = await requestUrl({ ...request, throw: false });
              return {
                status: response.status,
                json: response.json
              };
            });

            connectionStatusEl.setText(result.message);
            new Notice(result.message);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Confluence 연결 확인 중 알 수 없는 오류가 발생했습니다.";
            connectionStatusEl.setText(message);
            new Notice(message);
          } finally {
            button.setDisabled(false);
          }
        });
      });

    new Setting(containerEl)
      .setName("Default project folder")
      .setDesc("Confluence Markdown 산출물을 저장할 vault 내부 폴더입니다.")
      .addText((text) => {
        text
          .setPlaceholder("confluence")
          .setValue(this.plugin.settings.defaultProjectFolder)
          .onChange(async (value) => {
            this.plugin.settings.defaultProjectFolder = value.trim() || "confluence";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Safe delete folder")
      .setDesc("Confluence에서 사라진 문서를 즉시 삭제하지 않고 이동할 vault 내부 폴더입니다.")
      .addText((text) => {
        text
          .setPlaceholder(".confluence-sync/trash")
          .setValue(this.plugin.settings.safeDeleteFolder)
          .onChange(async (value) => {
            this.plugin.settings.safeDeleteFolder = value.trim() || ".confluence-sync/trash";
            await this.plugin.saveSettings();
          });
      });

    const projectStatusText = this.plugin.settings.currentProject === null
      ? "현재 생성된 Confluence 프로젝트가 없습니다."
      : `현재 프로젝트: ${this.plugin.settings.currentProject.projectName} (${this.plugin.settings.currentProject.localFolderPath})`;
    const projectStatusEl = containerEl.createEl("p", {
      cls: "confluence-sync-project-status",
      text: projectStatusText
    });

    new Setting(containerEl)
      .setName("Root page URL")
      .setDesc("로컬 프로젝트의 기준이 될 Confluence 루트 페이지 URL입니다.")
      .addText((text) => {
        text
          .setPlaceholder("https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root")
          .setValue(this.rootPageUrlInput)
          .onChange((value) => {
            this.rootPageUrlInput = value.trim();
          });
      });

    new Setting(containerEl)
      .setName("Create project")
      .setDesc("루트 페이지 메타데이터를 조회하고 vault 내부 프로젝트 manifest를 생성합니다.")
      .addButton((button) => {
        button.setButtonText("Create project").onClick(async () => {
          button.setDisabled(true);
          projectStatusEl.setText("Confluence 프로젝트를 생성하는 중입니다...");

          try {
            const result = await createProjectFromRootUrl({
              settings: this.plugin.settings,
              rawRootUrl: this.rootPageUrlInput,
              transport: async (request) => {
                const response = await requestUrl({ ...request, throw: false });
                return {
                  status: response.status,
                  json: response.json
                };
              },
              storage: createVaultStorageAdapter(this.plugin),
              now: () => new Date()
            });

            if (result.ok) {
              this.plugin.settings.currentProject = result.currentProject;
              await this.plugin.saveSettings();
            }

            projectStatusEl.setText(result.message);
            new Notice(result.message);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Confluence 프로젝트 생성 중 알 수 없는 오류가 발생했습니다.";
            projectStatusEl.setText(message);
            new Notice(message);
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }
}
```

- [ ] **Step 2: Update Pull Tree prerequisite message**

Modify the `PULL_TREE_COMMAND_ID` callback in `src/main.ts`:

```typescript
    this.addCommand({
      id: PULL_TREE_COMMAND_ID,
      name: "Pull Tree",
      callback: () => {
        const missingFields = getMissingConfluenceConnectionFields(this.settings);

        if (missingFields.length > 0) {
          new Notice(`Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields.join(", ")}`);
          return;
        }

        if (this.settings.currentProject === null) {
          new Notice("Pull Tree 실행 전에 설정 화면에서 루트 페이지 기반 프로젝트를 생성하세요.");
          return;
        }

        new Notice("Pull Tree는 페이지 트리 Pull Epic에서 구현됩니다.");
      }
    });
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm run verify
```

Expected:

```text
> confluence-obsidian-sync@0.1.0 verify
> pnpm run lint && pnpm run test && pnpm run build

...
PASS ...
```

- [ ] **Step 4: Commit**

Run:

```bash
git add src/settings/ConfluenceSyncSettingTab.ts src/main.ts
git commit -m "feat: 설정 화면에서 루트 페이지 프로젝트 생성"
```

## Task 9: Epic 문서 링크

**Files:**
- Modify: `docs/mvp-epics.md`

- [ ] **Step 1: Add Epic 3 implementation plan link**

Modify `docs/mvp-epics.md` under `Epic 3. 루트 페이지 기반 프로젝트 생성`:

```markdown
### 구현 계획

- [Root Page Project Creation Implementation Plan](superpowers/plans/2026-04-23-root-page-project-creation.md)
```

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/mvp-epics.md docs/superpowers/plans/2026-04-23-root-page-project-creation.md
git commit -m "docs: 루트 페이지 프로젝트 생성 구현 계획 추가"
```

## Final Verification

- [ ] **Step 1: Run all checks**

Run:

```bash
pnpm run verify
```

Expected:

```text
> confluence-obsidian-sync@0.1.0 verify
> pnpm run lint && pnpm run test && pnpm run build

...
PASS ...
```

- [ ] **Step 2: Manual Obsidian smoke test**

Run:

```bash
pnpm run prepare:current-vault
```

Expected:

```text
Copied plugin assets to ...
```

Then in Obsidian:

1. Open plugin settings.
2. Confirm Confluence base URL, email, token are configured.
3. Paste a root page URL like `https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root`.
4. Click `Create project`.
5. Confirm a success Notice appears.
6. Confirm `confluence/Project Root/.confluence-sync/manifest.json` exists in the vault.
7. Confirm plugin data has `currentProject` with `projectName`, `spaceId`, `rootPageId`, `rootUrl`, `localFolderPath`, `manifestPath`.

## Self-Review

- Spec coverage: URL에서 `pageId` 추출은 Task 2, 루트 페이지 메타데이터 조회는 Task 3, 프로젝트 이름/`spaceId`/`rootPageId`/`rootUrl` 저장은 Task 4/6/7, 로컬 저장 폴더 생성은 Task 5, 프로젝트 manifest 생성은 Task 5/7에서 다룬다.
- Placeholder scan: 금지된 미완성 표현은 본문에 남기지 않는다.
- Type consistency: `ConfluenceRequestTransport`, `RootPageMetadata`, `CurrentConfluenceProjectSettings`, `ConfluenceProjectManifest` 이름은 정의와 사용 위치가 일치한다.
