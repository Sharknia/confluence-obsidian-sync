import { describe, expect, it } from "vitest";
import {
  downloadConfluenceHtmlAttachment,
  fetchConfluencePageHtmlAttachments,
  type ConfluenceHtmlAttachment,
} from "./attachments";
import type { ConfluenceRequestTransport } from "./requestTransport";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

function createSettings(): ConfluenceSyncSettings {
  return {
    confluenceBaseUrl: "https://selta.atlassian.net",
    userEmail: "owner@example.com",
    apiToken: "secret-token",
    defaultRootContentUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/100/Root",
    defaultProjectFolder: "confluence",
    safeDeleteFolder: ".confluence-sync/trash",
    graphifyExecutablePath: "",
    graphifyTimeoutSeconds: 600,
    currentProject: null,
  };
}

function createHtmlAttachment(overrides: Partial<ConfluenceHtmlAttachment> = {}): ConfluenceHtmlAttachment {
  return {
    id: "att-html",
    pageId: "100",
    pageTitle: "Root",
    title: "prototype.html",
    mediaType: "text/html",
    fileSize: 42,
    downloadLink: "/wiki/download/attachments/100/prototype.html?version=3",
    versionNumber: 3,
    ...overrides,
  };
}

describe("fetchConfluencePageHtmlAttachments", () => {
  it("fetches only current HTML attachments for a page", async () => {
    const requestedUrls: string[] = [];
    const requestedHeaders: Array<Record<string, string>> = [];
    const transport: ConfluenceRequestTransport = (request) => {
      requestedUrls.push(request.url);
      requestedHeaders.push(request.headers as Record<string, string>);

      return Promise.resolve({
        status: 200,
        json: {
          results: [
            {
              id: "att-html",
              status: "current",
              title: "nav-prototype_6.html",
              pageId: "100",
              mediaType: "text/html",
              fileSize: 1234,
              downloadLink: "/wiki/download/attachments/100/nav-prototype_6.html?version=2",
              version: { number: 2 },
            },
            {
              id: "att-pdf",
              status: "current",
              title: "decision.pdf",
              pageId: "100",
              mediaType: "application/pdf",
              fileSize: 99,
              downloadLink: "/wiki/download/attachments/100/decision.pdf?version=1",
              version: { number: 1 },
            },
            {
              id: "att-archived-html",
              status: "archived",
              title: "old-prototype.html",
              pageId: "100",
              mediaType: "text/html",
              fileSize: 88,
              downloadLink: "/wiki/download/attachments/100/old-prototype.html?version=1",
              version: { number: 1 },
            },
          ],
          _links: {},
        },
      });
    };

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Home Navigation", transport);

    expect(requestedUrls).toEqual([
      "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments?limit=250&status=current&mediaType=text%2Fhtml",
    ]);
    expect(requestedHeaders).toEqual([
      {
        Accept: "application/json",
        Authorization: "Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu",
      },
    ]);
    expect(result).toEqual({
      attachments: [
        {
          id: "att-html",
          pageId: "100",
          pageTitle: "Home Navigation",
          title: "nav-prototype_6.html",
          mediaType: "text/html",
          fileSize: 1234,
          downloadLink: "/wiki/download/attachments/100/nav-prototype_6.html?version=2",
          versionNumber: 2,
        },
      ],
      issues: [],
    });
  });

  it("follows JSON next links while fetching page attachments", async () => {
    const requestedUrls: string[] = [];
    const transport: ConfluenceRequestTransport = (request) => {
      requestedUrls.push(request.url);

      if (request.url.endsWith("cursor=next-page")) {
        return Promise.resolve({
          status: 200,
          json: {
            results: [
              {
                id: "att-second",
                status: "current",
                title: "second.html",
                pageId: "100",
                mediaType: "text/html",
                downloadLink: "/wiki/download/attachments/100/second.html",
                version: { number: 1 },
              },
            ],
            _links: {},
          },
        });
      }

      return Promise.resolve({
        status: 200,
        json: {
          results: [],
          _links: { next: "/wiki/api/v2/pages/100/attachments?cursor=next-page" },
        },
      });
    };

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Root", transport);

    expect(requestedUrls).toEqual([
      "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments?limit=250&status=current&mediaType=text%2Fhtml",
      "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments?cursor=next-page",
    ]);
    expect(result.attachments.map((attachment) => attachment.title)).toEqual(["second.html"]);
    expect(result.issues).toEqual([]);
  });

  it("records an issue when the attachments next link is malformed", async () => {
    const transport: ConfluenceRequestTransport = () =>
      Promise.resolve({
        status: 200,
        json: {
          results: [],
          _links: { next: "https://[not-a-url" },
        },
      });

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Root", transport);

    expect(result).toEqual({
      attachments: [],
      issues: [
        {
          pageId: "100",
          pageTitle: "Root",
          attachmentId: null,
          attachmentTitle: null,
          reason: "invalid-response",
          message: "Confluence HTML 첨부 목록의 다음 페이지 링크 형식이 올바르지 않습니다.",
        },
      ],
    });
  });

  it("records an issue when attachment pagination repeats a URL", async () => {
    const requestedUrls: string[] = [];
    const transport: ConfluenceRequestTransport = (request) => {
      requestedUrls.push(request.url);

      if (requestedUrls.length > 1) {
        return Promise.reject(new Error("duplicate URL should be rejected before requesting again"));
      }

      return Promise.resolve({
        status: 200,
        json: {
          results: [],
          _links: { next: "/wiki/api/v2/pages/100/attachments?limit=250&status=current&mediaType=text%2Fhtml" },
        },
      });
    };

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Root", transport);

    expect(requestedUrls).toEqual([
      "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments?limit=250&status=current&mediaType=text%2Fhtml",
    ]);
    expect(result).toEqual({
      attachments: [],
      issues: [
        {
          pageId: "100",
          pageTitle: "Root",
          attachmentId: null,
          attachmentTitle: null,
          reason: "invalid-response",
          message: "Confluence HTML 첨부 목록의 다음 페이지 링크가 이미 처리된 URL을 가리킵니다.",
        },
      ],
    });
  });

  it("records an issue when attachment fetching returns a non-200 response", async () => {
    const transport: ConfluenceRequestTransport = () =>
      Promise.resolve({
        status: 503,
        json: { message: "Service unavailable" },
      });

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Root", transport);

    expect(result).toEqual({
      attachments: [],
      issues: [
        {
          pageId: "100",
          pageTitle: "Root",
          attachmentId: null,
          attachmentTitle: null,
          reason: "api-error",
          message: "Confluence HTML 첨부 목록 조회 중 API 오류가 발생했습니다. HTTP 503",
        },
      ],
    });
  });

  it("records an issue when attachment fetching returns invalid JSON", async () => {
    const transport: ConfluenceRequestTransport = () =>
      Promise.resolve({
        status: 200,
        json: { results: "not-an-array" },
      });

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Root", transport);

    expect(result).toEqual({
      attachments: [],
      issues: [
        {
          pageId: "100",
          pageTitle: "Root",
          attachmentId: null,
          attachmentTitle: null,
          reason: "invalid-response",
          message: "Confluence HTML 첨부 목록 응답 형식이 올바르지 않습니다.",
        },
      ],
    });
  });

  it("records an issue when attachment fetching fails with a network error", async () => {
    const transport: ConfluenceRequestTransport = () => Promise.reject(new Error("offline"));

    const result = await fetchConfluencePageHtmlAttachments(createSettings(), "100", "Root", transport);

    expect(result).toEqual({
      attachments: [],
      issues: [
        {
          pageId: "100",
          pageTitle: "Root",
          attachmentId: null,
          attachmentTitle: null,
          reason: "network-error",
          message: "네트워크 오류로 Confluence HTML 첨부 목록을 조회할 수 없습니다.",
        },
      ],
    });
  });
});

describe("downloadConfluenceHtmlAttachment", () => {
  it("downloads an HTML attachment with Confluence basic auth", async () => {
    const attachment = createHtmlAttachment();
    const requestedHeaders: Array<Record<string, string>> = [];
    const transport: ConfluenceRequestTransport = (request) => {
      requestedHeaders.push(request.headers as Record<string, string>);

      return Promise.resolve({
        status: 200,
        json: null,
        text: "<html><body>Prototype</body></html>",
      });
    };

    const result = await downloadConfluenceHtmlAttachment(createSettings(), attachment, transport);

    expect(requestedHeaders).toEqual([
      {
        Accept: "text/html,application/xhtml+xml,*/*",
        Authorization: "Basic b3duZXJAZXhhbXBsZS5jb206c2VjcmV0LXRva2Vu",
      },
    ]);
    expect(result).toEqual({ ok: true, html: "<html><body>Prototype</body></html>" });
  });

  it("downloads an HTML attachment from an arrayBuffer response", async () => {
    const attachment = createHtmlAttachment();
    const transport: ConfluenceRequestTransport = () =>
      Promise.resolve({
        status: 200,
        json: null,
        arrayBuffer: new TextEncoder().encode("<html><body>Buffer</body></html>").buffer,
      });

    const result = await downloadConfluenceHtmlAttachment(createSettings(), attachment, transport);

    expect(result).toEqual({ ok: true, html: "<html><body>Buffer</body></html>" });
  });

  it("records an issue when attachment download returns a non-200 response", async () => {
    const attachment = createHtmlAttachment();
    const transport: ConfluenceRequestTransport = () =>
      Promise.resolve({
        status: 404,
        json: { message: "Not found" },
      });

    const result = await downloadConfluenceHtmlAttachment(createSettings(), attachment, transport);

    expect(result).toEqual({
      ok: false,
      issue: {
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-html",
        attachmentTitle: "prototype.html",
        reason: "api-error",
        message: "Confluence HTML 첨부 다운로드 중 API 오류가 발생했습니다. HTTP 404",
      },
    });
  });

  it("records an issue when attachment download returns no body", async () => {
    const attachment = createHtmlAttachment();
    const transport: ConfluenceRequestTransport = () =>
      Promise.resolve({
        status: 200,
        json: null,
      });

    const result = await downloadConfluenceHtmlAttachment(createSettings(), attachment, transport);

    expect(result).toEqual({
      ok: false,
      issue: {
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-html",
        attachmentTitle: "prototype.html",
        reason: "invalid-response",
        message: "Confluence HTML 첨부 다운로드 응답 본문이 비어 있습니다.",
      },
    });
  });

  it("records an issue when attachment download fails with a network error", async () => {
    const attachment = createHtmlAttachment();
    const transport: ConfluenceRequestTransport = () => Promise.reject(new Error("offline"));

    const result = await downloadConfluenceHtmlAttachment(createSettings(), attachment, transport);

    expect(result).toEqual({
      ok: false,
      issue: {
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-html",
        attachmentTitle: "prototype.html",
        reason: "network-error",
        message: "네트워크 오류로 Confluence HTML 첨부를 다운로드할 수 없습니다. attachment=prototype.html cause=offline",
      },
    });
  });

  it("rejects cross-origin attachment download links", async () => {
    const attachment = createHtmlAttachment({
      fileSize: null,
      downloadLink: "https://evil.example.com/prototype.html",
      versionNumber: null,
    });
    const transport: ConfluenceRequestTransport = () => Promise.reject(new Error("transport should not be called"));

    const result = await downloadConfluenceHtmlAttachment(createSettings(), attachment, transport);

    expect(result).toEqual({
      ok: false,
      issue: {
        pageId: "100",
        pageTitle: "Root",
        attachmentId: "att-html",
        attachmentTitle: "prototype.html",
        reason: "invalid-download-link",
        message: "Confluence HTML 첨부 다운로드 링크가 base URL과 다른 origin을 가리킵니다.",
      },
    });
  });
});
