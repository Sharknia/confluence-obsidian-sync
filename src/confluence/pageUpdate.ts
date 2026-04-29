import type { RequestUrlParam } from "obsidian";
import {
  classifyConfluenceHttpFailure,
  createConfluenceNetworkFailure,
  type ConfluenceApiFailureReason
} from "./apiFailure";
import { buildBasicAuthorizationHeader, buildConfluenceApiUrl } from "./authentication";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export type ConfluencePagePushFailureReason = ConfluenceApiFailureReason;

export interface ConfluencePageForPush {
  pageId: string;
  title: string;
  versionNumber: number;
}

export interface ConfluencePagePushSuccess {
  ok: true;
  page: ConfluencePageForPush;
}

export interface ConfluencePagePushFailure {
  ok: false;
  reason: ConfluencePagePushFailureReason;
  message: string;
}

export type ConfluencePagePushResult = ConfluencePagePushSuccess | ConfluencePagePushFailure;

export interface ConfluencePageForPull {
  pageId: string;
  title: string;
  parentId: string | null;
  versionNumber: number;
  bodyStorageValue: string;
}

export type ConfluencePagePullResult =
  | {
      ok: true;
      page: ConfluencePageForPull;
    }
  | ConfluencePagePushFailure;

export interface UpdateConfluencePageBodyInput {
  pageId: string;
  title: string;
  nextVersionNumber: number;
  bodyStorageValue: string;
}

interface PageForPushApiResponse {
  id: string;
  title: string;
  version: {
    number: number;
  };
}

interface PageForPullApiResponse {
  id: string;
  title: string;
  parentId?: string | null;
  version: {
    number: number;
  };
  body: {
    storage: {
      value: string;
    };
  };
}

function createAuthorizationHeader(settings: ConfluenceSyncSettings): string {
  return buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken);
}

function createPageForPushRequest(settings: ConfluenceSyncSettings, pageId: string): RequestUrlParam {
  return {
    url: buildConfluenceApiUrl(settings.confluenceBaseUrl, `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function createPageForPullRequest(settings: ConfluenceSyncSettings, pageId: string): RequestUrlParam {
  return {
    url: `${buildConfluenceApiUrl(
      settings.confluenceBaseUrl,
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`
    )}?body-format=storage`,
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function createUpdatePageBodyRequest(
  settings: ConfluenceSyncSettings,
  input: UpdateConfluencePageBodyInput
): RequestUrlParam {
  return {
    url: buildConfluenceApiUrl(settings.confluenceBaseUrl, `/wiki/api/v2/pages/${encodeURIComponent(input.pageId)}`),
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: createAuthorizationHeader(settings)
    },
    body: JSON.stringify({
      id: input.pageId,
      status: "current",
      title: input.title,
      body: {
        representation: "storage",
        value: input.bodyStorageValue
      },
      version: {
        number: input.nextVersionNumber
      }
    })
  };
}

function buildFailure(
  reason: ConfluencePagePushFailureReason,
  message: string
): ConfluencePagePushFailure {
  return { ok: false, reason, message };
}

function classifyPageUpdateHttpFailure(status: number): ConfluencePagePushFailure {
  const failure = classifyConfluenceHttpFailure(status, {
    permissionDeniedMessage: "Confluence 페이지를 수정할 권한이 없습니다.",
    notFoundMessage: "Confluence 페이지를 찾을 수 없습니다."
  });

  return buildFailure(failure.reason, failure.message);
}

function classifyPageReadHttpFailure(status: number): ConfluencePagePushFailure {
  const failure = classifyConfluenceHttpFailure(status, {
    notFoundMessage: "Confluence 페이지를 찾을 수 없습니다."
  });

  return buildFailure(failure.reason, failure.message);
}

async function requestConfluence(
  transport: ConfluenceRequestTransport,
  request: RequestUrlParam,
  networkErrorMessage: string
): Promise<ConfluenceRequestResult | ConfluencePagePushFailure> {
  try {
    return await transport(request);
  } catch {
    const failure = createConfluenceNetworkFailure(networkErrorMessage);

    return buildFailure(failure.reason, failure.message);
  }
}

function isPushFailure(value: ConfluenceRequestResult | ConfluencePagePushFailure): value is ConfluencePagePushFailure {
  return "ok" in value && value.ok === false;
}

function isPageForPushApiResponse(value: unknown): value is PageForPushApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as {
    id?: unknown;
    title?: unknown;
    version?: {
      number?: unknown;
    } | null;
  };

  return (
    typeof response.id === "string" &&
    response.id.length > 0 &&
    typeof response.title === "string" &&
    response.title.length > 0 &&
    typeof response.version === "object" &&
    response.version !== null &&
    typeof response.version.number === "number" &&
    Number.isInteger(response.version.number) &&
    response.version.number > 0
  );
}

function isPageForPullApiResponse(value: unknown): value is PageForPullApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as {
    id?: unknown;
    title?: unknown;
    parentId?: unknown;
    version?: {
      number?: unknown;
    } | null;
    body?: {
      storage?: {
        value?: unknown;
      } | null;
    } | null;
  };

  return (
    typeof response.id === "string" &&
    response.id.length > 0 &&
    typeof response.title === "string" &&
    response.title.length > 0 &&
    (response.parentId === undefined || response.parentId === null || typeof response.parentId === "string") &&
    typeof response.version === "object" &&
    response.version !== null &&
    typeof response.version.number === "number" &&
    Number.isInteger(response.version.number) &&
    response.version.number > 0 &&
    typeof response.body === "object" &&
    response.body !== null &&
    typeof response.body.storage === "object" &&
    response.body.storage !== null &&
    typeof response.body.storage.value === "string"
  );
}

function parsePageForPushResponse(json: unknown): ConfluencePagePushResult {
  if (!isPageForPushApiResponse(json)) {
    return buildFailure("invalid-response", "Confluence 페이지 응답 형식이 올바르지 않습니다.");
  }

  return {
    ok: true,
    page: {
      pageId: json.id,
      title: json.title,
      versionNumber: json.version.number
    }
  };
}

function parsePageForPullResponse(json: unknown): ConfluencePagePullResult {
  if (!isPageForPullApiResponse(json)) {
    return buildFailure("invalid-response", "Confluence 페이지 storage 본문 응답 형식이 올바르지 않습니다.");
  }

  return {
    ok: true,
    page: {
      pageId: json.id,
      title: json.title,
      parentId: json.parentId ?? null,
      versionNumber: json.version.number,
      bodyStorageValue: json.body.storage.value
    }
  };
}

export async function fetchConfluencePageForPush(
  settings: ConfluenceSyncSettings,
  pageId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluencePagePushResult> {
  const response = await requestConfluence(
    transport,
    createPageForPushRequest(settings, pageId),
    "네트워크 오류로 Confluence 페이지를 조회할 수 없습니다."
  );

  if (isPushFailure(response)) {
    return response;
  }

  if (response.status !== 200) {
    return classifyPageUpdateHttpFailure(response.status);
  }

  return parsePageForPushResponse(response.json);
}

export async function fetchConfluencePageForPull(
  settings: ConfluenceSyncSettings,
  pageId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluencePagePullResult> {
  const response = await requestConfluence(
    transport,
    createPageForPullRequest(settings, pageId),
    "네트워크 오류로 Confluence 페이지 본문을 조회할 수 없습니다."
  );

  if (isPushFailure(response)) {
    return response;
  }

  if (response.status !== 200) {
    return classifyPageReadHttpFailure(response.status);
  }

  return parsePageForPullResponse(response.json);
}

export async function updateConfluencePageBody(
  settings: ConfluenceSyncSettings,
  input: UpdateConfluencePageBodyInput,
  transport: ConfluenceRequestTransport
): Promise<ConfluencePagePushResult> {
  const response = await requestConfluence(
    transport,
    createUpdatePageBodyRequest(settings, input),
    "네트워크 오류로 Confluence 페이지를 업데이트할 수 없습니다."
  );

  if (isPushFailure(response)) {
    return response;
  }

  if (response.status !== 200) {
    return classifyPageUpdateHttpFailure(response.status);
  }

  const parsedUpdateResponse = parsePageForPushResponse(response.json);

  if (parsedUpdateResponse.ok) {
    return parsedUpdateResponse;
  }

  return fetchConfluencePageForPush(settings, input.pageId, transport);
}
