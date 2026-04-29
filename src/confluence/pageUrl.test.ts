import { describe, expect, it } from "vitest";
import { buildConfluencePageViewUrl, parseConfluencePageUrl, parseConfluenceRootUrl } from "./pageUrl";

describe("parseConfluencePageUrl", () => {
  it("parses a space root page URL and strips the hash from the stored root URL", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root#section",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: true,
      pageId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root"
    });
  });

  it("parses a legacy viewpage URL", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321#comments",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: true,
      pageId: "987654321",
      rootUrl: "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321"
    });
  });

  it("rejects non-numeric query pageId values", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=abc",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("rejects non-numeric query pageId values even when the path contains a numeric page id", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root?pageId=abc",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("strips incidental query parameters from modern page URLs", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root?atlOrigin=abc&focusedCommentId=111",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: true,
      pageId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root"
    });
  });

  it("keeps only pageId on legacy viewpage URLs", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321&atlOrigin=abc",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: true,
      pageId: "987654321",
      rootUrl: "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321"
    });
  });

  it("returns base-url-mismatch when the origins differ", () => {
    const result = parseConfluencePageUrl(
      "https://other.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: false,
      reason: "base-url-mismatch",
      message: "Confluence 루트 페이지 URL의 origin이 base URL과 일치하지 않습니다."
    });
  });

  it("returns invalid-url when the root URL cannot be parsed", () => {
    const result = parseConfluencePageUrl("not-a-valid-url", "https://selta.atlassian.net/wiki");

    expect(result).toEqual({
      ok: false,
      reason: "invalid-url",
      message: "Confluence 루트 페이지 URL을 해석할 수 없습니다."
    });
  });

  it("returns invalid-url when the base URL cannot be parsed", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=987654321",
      "not-a-valid-url"
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid-url",
      message: "Confluence base URL을 해석할 수 없습니다."
    });
  });

  it("returns missing-page-id when the URL does not contain a page id", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/Project+Root",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("rejects page-looking URLs outside the Confluence wiki namespace", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/spaces/DEV/pages/123456789/Project+Root",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("rejects unsupported same-origin paths even when they contain a numeric pages segment", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/other/pages/123456789/Project+Root",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("rejects unsupported child paths below a modern page URL", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root/attachments/999/file.txt",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });

  it("rejects folder URLs", () => {
    const result = parseConfluencePageUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    });
  });
});

describe("parseConfluenceRootUrl", () => {
  it("parses a page URL as root content", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root?atlOrigin=abc#section",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: true,
      rootContentType: "page",
      rootContentId: "123456789",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root"
    });
  });

  it("parses a folder URL as root content", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder?atlOrigin=abc#children",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: true,
      rootContentType: "folder",
      rootContentId: "987654321",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/DEV/folders/987654321/Team+Folder"
    });
  });

  it("parses a singular folder URL as root content", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/IS/folder/23167000?atlOrigin=abc",
      "https://selta.atlassian.net/wiki"
    );

    expect(result).toEqual({
      ok: true,
      rootContentType: "folder",
      rootContentId: "23167000",
      rootUrl: "https://selta.atlassian.net/wiki/spaces/IS/folder/23167000"
    });
  });

  it("rejects unsupported same-origin URLs without root content ids", () => {
    const result = parseConfluenceRootUrl(
      "https://selta.atlassian.net/wiki/spaces/DEV",
      "https://selta.atlassian.net"
    );

    expect(result).toEqual({
      ok: false,
      reason: "missing-root-content-id",
      message: "Confluence 루트 콘텐츠 URL에서 pageId 또는 folderId를 찾을 수 없습니다."
    });
  });
});

describe("buildConfluencePageViewUrl", () => {
  it("builds a legacy view URL that can open a page by id", () => {
    expect(buildConfluencePageViewUrl("https://selta.atlassian.net/", "100/200")).toBe(
      "https://selta.atlassian.net/wiki/pages/viewpage.action?pageId=100%2F200"
    );
  });
});
