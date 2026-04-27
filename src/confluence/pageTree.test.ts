import { describe, expect, it } from "vitest";
import type { RequestUrlParam } from "obsidian";
import { fetchConfluencePageTree } from "./pageTree";
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

function createSequencedTransport(responses: ConfluenceRequestResult[]): {
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

      return Promise.resolve(response);
    }
  };
}

describe("fetchConfluencePageTree", () => {
  it("returns a root-only tree when the page has no descendants", async () => {
    const { requests, transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          spaceId: "SPACE",
          version: { number: 3 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 200,
        json: {
          results: [],
          _links: {}
        }
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: true,
      root: {
        pageId: "100",
        title: "Root",
        parentId: null,
        versionNumber: 3,
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
          versionNumber: 3,
          sourceUrl: "https://selta.atlassian.net/wiki/spaces/SPACE/pages/100/Root",
          depth: 0,
          childPosition: 0
        }
      ],
      errors: []
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://selta.atlassian.net/wiki/api/v2/pages/100",
      "https://selta.atlassian.net/wiki/api/v2/pages/100/descendants?limit=100"
    ]);
  });

  it("fetches paginated page descendants and preserves hierarchy", async () => {
    const { requests, transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 200,
        json: {
          results: [
            { id: "200", title: "Child A", type: "page", parentId: "100", depth: 1, childPosition: 0 },
            { id: "300", title: "Child B", type: "page", parentId: "100", depth: 1, childPosition: 1 }
          ],
          _links: { next: "/wiki/api/v2/pages/100/descendants?limit=100&cursor=next-token" }
        }
      },
      {
        status: 200,
        json: {
          results: [
            { id: "400", title: "Grandchild", type: "page", parentId: "200", depth: 2, childPosition: 0 },
            { id: "500", title: "Ignored Folder", type: "folder" }
          ],
          _links: {}
        }
      },
      {
        status: 200,
        json: {
          id: "200",
          title: "Child A",
          version: { number: 2 },
          _links: { webui: "/wiki/spaces/SPACE/pages/200/Child+A" }
        }
      },
      {
        status: 200,
        json: {
          id: "300",
          title: "Child B",
          version: { number: 5 },
          _links: { webui: "/wiki/spaces/SPACE/pages/300/Child+B" }
        }
      },
      {
        status: 200,
        json: {
          id: "400",
          title: "Grandchild",
          version: { number: 8 },
          _links: { webui: "/wiki/spaces/SPACE/pages/400/Grandchild" }
        }
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(requests.map((request) => request.url)).toEqual([
      "https://selta.atlassian.net/wiki/api/v2/pages/100",
      "https://selta.atlassian.net/wiki/api/v2/pages/100/descendants?limit=100",
      "https://selta.atlassian.net/wiki/api/v2/pages/100/descendants?limit=100&cursor=next-token",
      "https://selta.atlassian.net/wiki/api/v2/pages/200",
      "https://selta.atlassian.net/wiki/api/v2/pages/300",
      "https://selta.atlassian.net/wiki/api/v2/pages/400"
    ]);
    expect(result.pages.map((page) => page.pageId)).toEqual(["100", "200", "300", "400"]);
    expect(result.root.children.map((page) => page.pageId)).toEqual(["200", "300"]);
    expect(result.root.children[0].children.map((page) => page.pageId)).toEqual(["400"]);
    expect(result.errors).toEqual([]);
  });

  it("continues pulling other pages when a descendant page detail request fails", async () => {
    const { transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 200,
        json: {
          results: [
            { id: "200", title: "Accessible", type: "page", parentId: "100", depth: 1, childPosition: 0 },
            { id: "300", title: "Forbidden", type: "page", parentId: "100", depth: 1, childPosition: 1 },
            { id: "400", title: "Still Accessible", type: "page", parentId: "100", depth: 1, childPosition: 2 }
          ],
          _links: {}
        }
      },
      {
        status: 200,
        json: {
          id: "200",
          title: "Accessible",
          version: { number: 2 },
          _links: { webui: "/wiki/spaces/SPACE/pages/200/Accessible" }
        }
      },
      {
        status: 403,
        json: {}
      },
      {
        status: 200,
        json: {
          id: "400",
          title: "Still Accessible",
          version: { number: 4 },
          _links: { webui: "/wiki/spaces/SPACE/pages/400/Still+Accessible" }
        }
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.pages.map((page) => page.pageId)).toEqual(["100", "200", "400"]);
    expect(result.root.children.map((page) => page.pageId)).toEqual(["200", "400"]);
    expect(result.errors).toEqual([
      {
        pageId: "300",
        title: "Forbidden",
        reason: "permission-denied",
        message: "Confluence 페이지 트리에 접근할 권한이 없습니다."
      }
    ]);
  });

  it("records thrown descendant page detail errors and continues", async () => {
    const requests: RequestUrlParam[] = [];
    const responses: Array<ConfluenceRequestResult | Error> = [
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 200,
        json: {
          results: [
            { id: "200", title: "Network Failed", type: "page", parentId: "100", depth: 1, childPosition: 0 },
            { id: "300", title: "Accessible", type: "page", parentId: "100", depth: 1, childPosition: 1 }
          ],
          _links: {}
        }
      },
      new Error("ECONNRESET"),
      {
        status: 200,
        json: {
          id: "300",
          title: "Accessible",
          version: { number: 2 },
          _links: { webui: "/wiki/spaces/SPACE/pages/300/Accessible" }
        }
      }
    ];
    const transport: ConfluenceRequestTransport = (request) => {
      requests.push(request);
      const response = responses.shift();

      if (response instanceof Error) {
        return Promise.reject(response);
      }

      if (response === undefined) {
        return Promise.reject(new Error("Unexpected request"));
      }

      return Promise.resolve(response);
    };

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.pages.map((page) => page.pageId)).toEqual(["100", "300"]);
    expect(result.errors).toEqual([
      {
        pageId: "200",
        title: "Network Failed",
        reason: "network-error",
        message: "네트워크 오류로 Confluence 페이지를 조회할 수 없습니다."
      }
    ]);
    expect(requests).toHaveLength(4);
  });

  it("returns a critical failure when the root page cannot be fetched", async () => {
    const { transport } = createSequencedTransport([{ status: 404, json: {} }]);

    const result = await fetchConfluencePageTree(createSettings(), "missing", transport);

    expect(result).toEqual({
      ok: false,
      reason: "not-found",
      message: "Confluence 루트 페이지를 찾을 수 없습니다."
    });
  });

  it("returns a critical failure when descendants pagination fails", async () => {
    const { transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 500,
        json: {}
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 500"
    });
  });

  it("returns invalid-response when descendants payload has no results array", async () => {
    const { transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 200,
        json: {
          _links: {}
        }
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result).toEqual({
      ok: false,
      reason: "invalid-response",
      message: "Confluence descendants 응답 형식이 올바르지 않습니다."
    });
  });

  it("uses a stable source URL fallback when page detail has no webui link", async () => {
    const { transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { base: "https://selta.atlassian.net/wiki" }
        }
      },
      {
        status: 200,
        json: {
          results: [
            { id: "200", title: "Child", type: "page", parentId: "100", depth: 1, childPosition: 0 }
          ],
          _links: {}
        }
      },
      {
        status: 200,
        json: {
          id: "200",
          title: "Child",
          version: { number: 2 },
          _links: { base: "https://selta.atlassian.net/wiki" }
        }
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.pages.map((page) => page.sourceUrl)).toEqual([
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=100",
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=200"
    ]);
  });

  it("records an error when a page cannot be attached because its parent is not a pulled page", async () => {
    const { transport } = createSequencedTransport([
      {
        status: 200,
        json: {
          id: "100",
          title: "Root",
          version: { number: 1 },
          _links: { webui: "/wiki/spaces/SPACE/pages/100/Root" }
        }
      },
      {
        status: 200,
        json: {
          results: [
            { id: "folder-1", title: "Folder", type: "folder", parentId: "100", depth: 1, childPosition: 0 },
            { id: "200", title: "Child Under Folder", type: "page", parentId: "folder-1", depth: 2, childPosition: 0 }
          ],
          _links: {}
        }
      },
      {
        status: 200,
        json: {
          id: "200",
          title: "Child Under Folder",
          version: { number: 2 },
          _links: { webui: "/wiki/spaces/SPACE/pages/200/Child+Under+Folder" }
        }
      }
    ]);

    const result = await fetchConfluencePageTree(createSettings(), "100", transport);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.pages.map((page) => page.pageId)).toEqual(["100", "200"]);
    expect(result.root.children).toEqual([]);
    expect(result.errors).toEqual([
      {
        pageId: "200",
        title: "Child Under Folder",
        reason: "invalid-response",
        message: "Confluence 페이지(200)의 부모(folder-1)를 페이지 트리에 연결할 수 없습니다."
      }
    ]);
  });
});
