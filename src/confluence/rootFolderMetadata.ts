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
