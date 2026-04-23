import { describe, expect, it } from "vitest";
import type { RequestUrlParam } from "obsidian";
import { checkConfluenceConnection, type ConfluenceRequestTransport } from "./connectionCheck";
import { buildBasicAuthorizationHeader } from "./authentication";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

function createSettings(overrides: Partial<ConfluenceSyncSettings> = {}): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    ...overrides
  };
}

function createTransport(response: Awaited<ReturnType<ConfluenceRequestTransport>>): ConfluenceRequestTransport {
  return async () => response;
}

describe("checkConfluenceConnection", () => {
  it("returns success with current user information", async () => {
    const capturedRequests: RequestUrlParam[] = [];
    const transport: ConfluenceRequestTransport = async (request) => {
      capturedRequests.push(request);

      return {
        status: 200,
        json: {
          accountId: "account-1",
          displayName: "Owner"
        }
      };
    };

    const result = await checkConfluenceConnection(createSettings(), transport);

    expect(result).toEqual({
      ok: true,
      accountId: "account-1",
      displayName: "Owner",
      message: "Confluence 연결에 성공했습니다: Owner"
    });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]).toMatchObject({
      url: "https://selta.atlassian.net/wiki/rest/api/user/current",
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthorizationHeader("owner@example.com", "secret-token")
      }
    });
  });

  it("returns missing-settings when required settings are blank", async () => {
    const result = await checkConfluenceConnection(
      createSettings({ userEmail: "", apiToken: "" }),
      createTransport({ status: 200, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-settings",
      message: "Confluence 연결 설정이 필요합니다: Atlassian account email, API token"
    });
  });

  it("classifies 401 as authentication failure", async () => {
    const result = await checkConfluenceConnection(createSettings(), createTransport({
      status: 401,
      json: {}
    }));

    expect(result).toEqual({
      ok: false,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    });
  });

  it("classifies 403 as permission denied", async () => {
    const result = await checkConfluenceConnection(createSettings(), createTransport({
      status: 403,
      json: {}
    }));

    expect(result).toEqual({
      ok: false,
      reason: "permission-denied",
      message: "Confluence 접근 권한이 없습니다. 계정의 Confluence 권한을 확인하세요."
    });
  });

  it("classifies thrown transport errors as network errors", async () => {
    const transport: ConfluenceRequestTransport = async () => {
      throw new Error("getaddrinfo ENOTFOUND selta.atlassian.net");
    };

    const result = await checkConfluenceConnection(createSettings(), transport);

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence에 연결할 수 없습니다. 인터넷 연결과 base URL을 확인하세요."
    });
  });

  it("classifies unexpected statuses as api-error", async () => {
    const result = await checkConfluenceConnection(createSettings(), createTransport({
      status: 500,
      json: {
        message: "Internal server error"
      }
    }));

    expect(result).toEqual({
      ok: false,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 500"
    });
  });
});
