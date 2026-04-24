import { buildBasicAuthorizationHeader, buildConfluenceApiUrl } from "./authentication";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";

export type ConfluenceRootPageMetadataFailureReason =
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "network-error"
  | "invalid-response"
  | "api-error";

export interface ConfluenceRootPageMetadata {
  pageId: string;
  title: string;
  spaceId: string;
  versionNumber: number;
}

export interface ConfluenceRootPageMetadataSuccess {
  ok: true;
  metadata: ConfluenceRootPageMetadata;
}

export interface ConfluenceRootPageMetadataFailure {
  ok: false;
  reason: ConfluenceRootPageMetadataFailureReason;
  message: string;
}

export type ConfluenceRootPageMetadataResult =
  | ConfluenceRootPageMetadataSuccess
  | ConfluenceRootPageMetadataFailure;

interface RootPageMetadataApiResponse {
  id?: unknown;
  title?: unknown;
  spaceId?: unknown;
  version?: {
    number?: unknown;
  } | null;
}

function buildApiErrorMessage(status: number): string {
  return `Confluence API 오류가 발생했습니다. HTTP ${status}`;
}

function isRootPageMetadataResponse(value: unknown): value is RootPageMetadataApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as RootPageMetadataApiResponse;

  if (typeof response.id !== "string" || typeof response.title !== "string" || typeof response.spaceId !== "string") {
    return false;
  }

  if (typeof response.version !== "object" || response.version === null) {
    return false;
  }

  return typeof response.version.number === "number";
}

function createRequestUrl(settings: ConfluenceSyncSettings, pageId: string): string {
  return buildConfluenceApiUrl(settings.confluenceBaseUrl, `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`);
}

function createAuthorizationHeader(settings: ConfluenceSyncSettings): string {
  return buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken);
}

function createRequest(settings: ConfluenceSyncSettings, pageId: string) {
  return {
    url: createRequestUrl(settings, pageId),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function toMetadata(response: RootPageMetadataApiResponse): ConfluenceRootPageMetadata {
  return {
    pageId: response.id as string,
    title: response.title as string,
    spaceId: response.spaceId as string,
    versionNumber: response.version?.number as number
  };
}

function buildFailure(
  reason: ConfluenceRootPageMetadataFailureReason,
  message: string
): ConfluenceRootPageMetadataFailure {
  return { ok: false, reason, message };
}

function classifyHttpFailure(status: number): ConfluenceRootPageMetadataFailure {
  if (status === 401) {
    return buildFailure(
      "authentication-failed",
      "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    );
  }

  if (status === 403) {
    return buildFailure("permission-denied", "루트 페이지에 접근할 권한이 없습니다.");
  }

  if (status === 404) {
    return buildFailure("not-found", "루트 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요.");
  }

  return buildFailure("api-error", buildApiErrorMessage(status));
}

export async function fetchRootPageMetadata(
  settings: ConfluenceSyncSettings,
  pageId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceRootPageMetadataResult> {
  let response: ConfluenceRequestResult;

  try {
    response = await transport(createRequest(settings, pageId));
  } catch {
    return buildFailure(
      "network-error",
      "네트워크 오류로 루트 페이지 메타데이터를 조회할 수 없습니다."
    );
  }

  if (response.status !== 200) {
    return classifyHttpFailure(response.status);
  }

  if (!isRootPageMetadataResponse(response.json)) {
    return buildFailure(
      "invalid-response",
      "Confluence 루트 페이지 응답 형식이 올바르지 않습니다."
    );
  }

  return {
    ok: true,
    metadata: toMetadata(response.json)
  };
}
