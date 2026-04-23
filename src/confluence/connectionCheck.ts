import type { RequestUrlParam } from "obsidian";
import {
  buildBasicAuthorizationHeader,
  buildConfluenceApiUrl,
  getMissingConfluenceConnectionFields
} from "./authentication";
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

export interface ConfluenceRequestResult {
  status: number;
  json: unknown;
}

export type ConfluenceRequestTransport = (request: RequestUrlParam) => Promise<ConfluenceRequestResult>;

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
