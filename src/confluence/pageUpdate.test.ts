import { describe, expect, it } from "vitest";
import type { RequestUrlParam } from "obsidian";
import { fetchConfluencePageForPull, fetchConfluencePageForPush, updateConfluencePageBody } from "./pageUpdate";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";
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

function createSequencedTransport(responses: Array<ConfluenceRequestResult | Error>): {
  requests: RequestUrlParam[];
  transport: ConfluenceRequestTransport;
} {
  const requests: RequestUrlParam[] = [];

  return {
    requests,
    transport: (request) => {
      requests.push(request);
      const response = responses.shift();

      if (response === undefined) {
        return Promise.reject(new Error("Unexpected request"));
      }

      if (response instanceof Error) {
        return Promise.reject(response);
      }

      return Promise.resolve(response);
    }
  };
}

describe("fetchConfluencePageForPush", () => {
  it("fetches page title and current version for optimistic locking", async () => {
    const { requests, transport } = createSequencedTransport([
      { status: 200, json: { id: "100", title: "Root", version: { number: 3 } } }
    ]);

    const result = await fetchConfluencePageForPush(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: true,
      page: {
        pageId: "100",
        title: "Root",
        versionNumber: 3
      }
    });
    expect(requests.map((request) => request.url)).toEqual(["https://selta.atlassian.net/wiki/api/v2/pages/100"]);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu"
    });
  });

  it("encodes page ids in the request URL", async () => {
    const { requests, transport } = createSequencedTransport([
      { status: 200, json: { id: "100/200", title: "Root", version: { number: 3 } } }
    ]);

    await fetchConfluencePageForPush(createSettings(), "100/200", transport);

    expect(requests[0]?.url).toBe("https://selta.atlassian.net/wiki/api/v2/pages/100%2F200");
  });

  it.each([
    {
      status: 401,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    },
    {
      status: 403,
      reason: "permission-denied",
      message: "Confluence 페이지를 수정할 권한이 없습니다."
    },
    {
      status: 404,
      reason: "not-found",
      message: "Confluence 페이지를 찾을 수 없습니다."
    },
    {
      status: 409,
      reason: "version-conflict",
      message: "Confluence 페이지 version이 충돌했습니다. Pull Tree 후 다시 시도하세요."
    },
    {
      status: 429,
      reason: "rate-limited",
      message: "Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"
    },
    {
      status: 500,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 500"
    }
  ])("classifies HTTP $status as $reason", async ({ status, reason, message }) => {
    const { transport } = createSequencedTransport([{ status, json: {} }]);

    const result = await fetchConfluencePageForPush(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason,
      message
    });
  });

  it("returns network-error when the request fails before receiving a response", async () => {
    const { transport } = createSequencedTransport([new Error("No route to host")]);

    const result = await fetchConfluencePageForPush(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence 페이지를 조회할 수 없습니다."
    });
  });

  it.each([
    { id: "100", title: "Root", version: {} },
    { id: "100", title: "", version: { number: 3 } },
    { id: "100", title: "Root", version: { number: "3" } },
    { id: 100, title: "Root", version: { number: 3 } }
  ])("returns invalid-response for malformed page responses", async (json) => {
    const { transport } = createSequencedTransport([{ status: 200, json }]);

    const result = await fetchConfluencePageForPush(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence 페이지 응답 형식이 올바르지 않습니다."
    });
  });
});

describe("updateConfluencePageBody", () => {
  it("updates page body with the next version number", async () => {
    const { requests, transport } = createSequencedTransport([
      { status: 200, json: { id: "100", title: "Root", version: { number: 4 } } }
    ]);

    const result = await updateConfluencePageBody(
      createSettings(),
      {
        pageId: "100",
        title: "Root",
        nextVersionNumber: 4,
        bodyStorageValue: "<p>Hello</p>"
      },
      transport
    );

    expect(result).toEqual({
      ok: true,
      page: {
        pageId: "100",
        title: "Root",
        versionNumber: 4
      }
    });
    expect(requests[0]?.url).toBe("https://selta.atlassian.net/wiki/api/v2/pages/100");
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu"
    });
    const requestBody = requests[0]?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(requestBody as string)).toEqual({
      id: "100",
      status: "current",
      title: "Root",
      body: {
        representation: "storage",
        value: "<p>Hello</p>"
      },
      version: {
        number: 4
      }
    });
  });

  it.each([
    {
      status: 401,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    },
    {
      status: 403,
      reason: "permission-denied",
      message: "Confluence 페이지를 수정할 권한이 없습니다."
    },
    {
      status: 404,
      reason: "not-found",
      message: "Confluence 페이지를 찾을 수 없습니다."
    },
    {
      status: 409,
      reason: "version-conflict",
      message: "Confluence 페이지 version이 충돌했습니다. Pull Tree 후 다시 시도하세요."
    },
    {
      status: 429,
      reason: "rate-limited",
      message: "Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"
    },
    {
      status: 503,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 503"
    }
  ])("classifies HTTP $status as $reason", async ({ status, reason, message }) => {
    const { transport } = createSequencedTransport([{ status, json: {} }]);

    const result = await updateConfluencePageBody(
      createSettings(),
      {
        pageId: "100",
        title: "Root",
        nextVersionNumber: 4,
        bodyStorageValue: "<p>Hello</p>"
      },
      transport
    );

    expect(result).toEqual({
      ok: false,
      reason,
      message
    });
  });

  it("returns network-error when the update request fails before receiving a response", async () => {
    const { transport } = createSequencedTransport([new Error("Connection reset")]);

    const result = await updateConfluencePageBody(
      createSettings(),
      {
        pageId: "100",
        title: "Root",
        nextVersionNumber: 4,
        bodyStorageValue: "<p>Hello</p>"
      },
      transport
    );

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence 페이지를 업데이트할 수 없습니다."
    });
  });

  it("returns invalid-response when the update response is malformed", async () => {
    const { transport } = createSequencedTransport([
      { status: 200, json: { id: "100", title: "Root", version: null } },
      { status: 200, json: { id: "100", title: "Root", version: { number: 4 } } }
    ]);

    const result = await updateConfluencePageBody(
      createSettings(),
      {
        pageId: "100",
        title: "Root",
        nextVersionNumber: 4,
        bodyStorageValue: "<p>Hello</p>"
      },
      transport
    );

    expect(result).toEqual({
      ok: true,
      page: {
        pageId: "100",
        title: "Root",
        versionNumber: 4
      }
    });
  });

  it("returns invalid-response when update response and recovery fetch are both malformed", async () => {
    const { requests, transport } = createSequencedTransport([
      { status: 200, json: { id: "100", title: "Root", version: null } },
      { status: 200, json: { id: "100", title: "Root", version: null } }
    ]);

    const result = await updateConfluencePageBody(
      createSettings(),
      {
        pageId: "100",
        title: "Root",
        nextVersionNumber: 4,
        bodyStorageValue: "<p>Hello</p>"
      },
      transport
    );

    expect(requests.map((request) => request.method)).toEqual(["PUT", "GET"]);
    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence 페이지 응답 형식이 올바르지 않습니다."
    });
  });
});

describe("fetchConfluencePageForPull", () => {
  it("fetches page version and storage body for current page pull", async () => {
    const { requests, transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          parentId: "50",
          version: { number: 4 },
          body: { storage: { value: "<p>Hello</p>" } }
        }
      }
    ]);

    const result = await fetchConfluencePageForPull(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: true,
      page: {
        pageId: "100",
        title: "Root",
        parentId: "50",
        versionNumber: 4,
        bodyStorageValue: "<p>Hello</p>"
      }
    });
    expect(requests[0]?.url).toBe("https://selta.atlassian.net/wiki/api/v2/pages/100?body-format=storage");
    expect(requests[0]?.method).toBe("GET");
  });

  it("returns invalid-response when storage body is missing", async () => {
    const { transport } = createSequencedTransport([
      { status: 200, json: { id: "100", title: "Root", version: { number: 4 }, body: {} } }
    ]);

    const result = await fetchConfluencePageForPull(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence 페이지 storage 본문 응답 형식이 올바르지 않습니다."
    });
  });

  it.each([
    {
      status: 401,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    },
    {
      status: 403,
      reason: "permission-denied",
      message: "Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."
    },
    {
      status: 404,
      reason: "not-found",
      message: "Confluence 페이지를 찾을 수 없습니다."
    },
    {
      status: 429,
      reason: "rate-limited",
      message: "Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"
    },
    {
      status: 500,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 500"
    }
  ])("classifies HTTP $status as $reason", async ({ status, reason, message }) => {
    const { transport } = createSequencedTransport([{ status, json: {} }]);

    const result = await fetchConfluencePageForPull(createSettings(), "100", transport);

    expect(result).toEqual({ ok: false, reason, message });
  });

  it("returns network-error when the request fails before receiving a response", async () => {
    const { transport } = createSequencedTransport([new Error("No route to host")]);

    const result = await fetchConfluencePageForPull(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason: "network-error",
      message: "네트워크 오류로 Confluence 페이지 본문을 조회할 수 없습니다."
    });
  });
});
