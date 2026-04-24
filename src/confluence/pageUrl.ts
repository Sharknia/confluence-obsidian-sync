import { normalizeConfluenceBaseUrl } from "../settings/defaultSettings";

export type ConfluencePageUrlParseFailureReason = "invalid-url" | "base-url-mismatch" | "missing-page-id";

export interface ConfluencePageUrlParseSuccess {
  ok: true;
  pageId: string;
  rootUrl: string;
}

export interface ConfluencePageUrlParseFailure {
  ok: false;
  reason: ConfluencePageUrlParseFailureReason;
  message: string;
}

export type ConfluencePageUrlParseResult = ConfluencePageUrlParseSuccess | ConfluencePageUrlParseFailure;

export function parseConfluencePageUrl(rawRootUrl: string, rawBaseUrl: string): ConfluencePageUrlParseResult {
  const normalizedBaseUrl = normalizeConfluenceBaseUrl(rawBaseUrl);

  const rootUrlResult = tryParseUrl(rawRootUrl, "Confluence 루트 페이지 URL");

  if (!rootUrlResult.ok) {
    return rootUrlResult;
  }

  const baseUrlResult = tryParseUrl(normalizedBaseUrl, "Confluence base URL");

  if (!baseUrlResult.ok) {
    return baseUrlResult;
  }

  const rootUrl = rootUrlResult.url;
  const baseUrl = baseUrlResult.url;

  if (rootUrl.origin !== baseUrl.origin) {
    return {
      ok: false,
      reason: "base-url-mismatch",
      message: "Confluence 루트 페이지 URL의 origin이 base URL과 일치하지 않습니다."
    };
  }

  const pageDetails = extractConfluencePageDetails(rootUrl);

  if (pageDetails === null) {
    return {
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    };
  }

  return {
    ok: true,
    pageId: pageDetails.pageId,
    rootUrl: buildCanonicalRootUrl(rootUrl, pageDetails)
  };
}

type ConfluencePageUrlKind = "modern-page" | "legacy-viewpage";

interface ConfluencePageDetails {
  pageId: string;
  kind: ConfluencePageUrlKind;
}

function extractConfluencePageDetails(url: URL): ConfluencePageDetails | null {
  const queryPageId = url.searchParams.get("pageId");

  if (url.pathname === "/wiki/pages/viewpage.action") {
    return isNumericPageId(queryPageId) ? { pageId: queryPageId, kind: "legacy-viewpage" } : null;
  }

  if (queryPageId !== null) {
    return null;
  }

  const pagePathMatch = url.pathname.match(/^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/[^/]+)?$/u);

  if (pagePathMatch === null) {
    return null;
  }

  const pageId = pagePathMatch[1];

  return pageId === undefined ? null : { pageId, kind: "modern-page" };
}

function isNumericPageId(value: string | null): value is string {
  return typeof value === "string" && /^\d+$/u.test(value);
}

function buildCanonicalRootUrl(rootUrl: URL, pageDetails: ConfluencePageDetails): string {
  if (pageDetails.kind === "legacy-viewpage") {
    return `${rootUrl.origin}${rootUrl.pathname}?pageId=${pageDetails.pageId}`;
  }

  return `${rootUrl.origin}${rootUrl.pathname}`;
}

function tryParseUrl(
  rawUrl: string,
  label: string
): { ok: true; url: URL } | { ok: false; reason: "invalid-url"; message: string } {
  try {
    return { ok: true, url: new URL(rawUrl) };
  } catch {
    return {
      ok: false,
      reason: "invalid-url",
      message: `${label}을 해석할 수 없습니다.`
    };
  }
}
