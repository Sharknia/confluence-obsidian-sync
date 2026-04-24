import { describe, expect, it } from "vitest";
import type { RequestUrlParam } from "obsidian";
import { buildBasicAuthorizationHeader } from "./authentication";
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
  return () => Promise.resolve(response);
}

describe("fetchRootPageMetadata", () => {
  it("returns root page metadata on success", async () => {
    const capturedRequests: RequestUrlParam[] = [];
    const transport: ConfluenceRequestTransport = (request) => {
      capturedRequests.push(request);

      return Promise.resolve({
        status: 200,
        json: {
          id: "12345",
          title: "Root Page",
          spaceId: "67890",
          version: {
            number: 7
          }
        }
      });
    };

    const result = await fetchRootPageMetadata(createSettings(), "12345", transport);

    expect(result).toEqual({
      ok: true,
      metadata: {
        pageId: "12345",
        title: "Root Page",
        spaceId: "67890",
        versionNumber: 7
      }
    });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]).toMatchObject({
      url: "https://selta.atlassian.net/wiki/api/v2/pages/12345",
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthorizationHeader("owner@example.com", "secret-token")
      }
    });
  });

  it("classifies 403 as permission denied", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "12345",
      createTransport({ status: 403, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "permission-denied",
      message: "루트 페이지에 접근할 권한이 없습니다."
    });
  });

  it("classifies 404 as not found", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "12345",
      createTransport({ status: 404, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "not-found",
      message: "루트 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    });
  });

  it("classifies invalid response payloads as invalid-response", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "12345",
      createTransport({
        status: 200,
        json: {
          id: "12345",
          title: "Root Page",
          version: {
            number: 7
          }
        }
      })
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence 루트 페이지 응답 형식이 올바르지 않습니다."
    });
  });

  it("classifies thrown transport errors as network errors", async () => {
    const transport: ConfluenceRequestTransport = () =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND selta.atlassian.net"));

    const result = await fetchRootPageMetadata(createSettings(), "12345", transport);

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 루트 페이지 메타데이터를 조회할 수 없습니다."
    });
  });

  it("classifies 401 as authentication failure", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "12345",
      createTransport({ status: 401, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    });
  });

  it("classifies unexpected statuses as api-error", async () => {
    const result = await fetchRootPageMetadata(
      createSettings(),
      "12345",
      createTransport({ status: 500, json: {} })
    );

    expect(result).toEqual({
      ok: false,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 500"
    });
  });
});
