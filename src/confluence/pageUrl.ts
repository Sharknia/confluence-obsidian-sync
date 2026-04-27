import { normalizeConfluenceBaseUrl } from "../settings/defaultSettings";

export type ConfluencePageUrlParseFailureReason = "invalid-url" | "base-url-mismatch" | "missing-page-id";
export type ConfluenceRootContentType = "page" | "folder";
export type ConfluenceRootUrlParseFailureReason = "invalid-url" | "base-url-mismatch" | "missing-root-content-id";

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

export interface ConfluenceRootUrlParseSuccess {
  ok: true;
  rootContentType: ConfluenceRootContentType;
  rootContentId: string;
  rootUrl: string;
}

export interface ConfluenceRootUrlParseFailure {
  ok: false;
  reason: ConfluenceRootUrlParseFailureReason;
  message: string;
}

export type ConfluenceRootUrlParseResult = ConfluenceRootUrlParseSuccess | ConfluenceRootUrlParseFailure;

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

  const pageDetails = extractConfluenceRootContentDetails(rootUrl);

  if (pageDetails === null || pageDetails.rootContentType !== "page") {
    return {
      ok: false,
      reason: "missing-page-id",
      message: "Confluence 페이지 URL에서 pageId를 찾을 수 없습니다."
    };
  }

  return {
    ok: true,
    pageId: pageDetails.rootContentId,
    rootUrl: buildCanonicalRootUrl(rootUrl, pageDetails)
  };
}

export function parseConfluenceRootUrl(rawRootUrl: string, rawBaseUrl: string): ConfluenceRootUrlParseResult {
  const normalizedBaseUrl = normalizeConfluenceBaseUrl(rawBaseUrl);

  const rootUrlResult = tryParseUrl(rawRootUrl, "Confluence 루트 콘텐츠 URL");

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
      message: "Confluence 루트 콘텐츠 URL의 origin이 base URL과 일치하지 않습니다."
    };
  }

  const rootContentDetails = extractConfluenceRootContentDetails(rootUrl);

  if (rootContentDetails === null) {
    return {
      ok: false,
      reason: "missing-root-content-id",
      message: "Confluence 루트 콘텐츠 URL에서 pageId 또는 folderId를 찾을 수 없습니다."
    };
  }

  return {
    ok: true,
    rootContentType: rootContentDetails.rootContentType,
    rootContentId: rootContentDetails.rootContentId,
    rootUrl: buildCanonicalRootUrl(rootUrl, rootContentDetails)
  };
}

type ConfluenceRootUrlKind = "modern-page" | "legacy-viewpage" | "modern-folder";

interface ConfluenceRootContentDetails {
  rootContentType: ConfluenceRootContentType;
  rootContentId: string;
  kind: ConfluenceRootUrlKind;
}

function extractConfluenceRootContentDetails(url: URL): ConfluenceRootContentDetails | null {
  const queryPageId = url.searchParams.get("pageId");

  if (url.pathname === "/wiki/pages/viewpage.action") {
    return isNumericPageId(queryPageId)
      ? { rootContentType: "page", rootContentId: queryPageId, kind: "legacy-viewpage" }
      : null;
  }

  if (queryPageId !== null) {
    return null;
  }

  const pagePathMatch = url.pathname.match(/^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/[^/]+)?$/u);

  if (pagePathMatch !== null) {
    const pageId = pagePathMatch[1];

    return pageId === undefined
      ? null
      : { rootContentType: "page", rootContentId: pageId, kind: "modern-page" };
  }

  const folderPathMatch = url.pathname.match(/^\/wiki\/spaces\/[^/]+\/folders\/(\d+)(?:\/[^/]+)?$/u);

  if (folderPathMatch !== null) {
    const folderId = folderPathMatch[1];

    return folderId === undefined
      ? null
      : { rootContentType: "folder", rootContentId: folderId, kind: "modern-folder" };
  }

  return null;
}

function isNumericPageId(value: string | null): value is string {
  return typeof value === "string" && /^\d+$/u.test(value);
}

function buildCanonicalRootUrl(rootUrl: URL, rootContentDetails: ConfluenceRootContentDetails): string {
  if (rootContentDetails.kind === "legacy-viewpage") {
    return `${rootUrl.origin}${rootUrl.pathname}?pageId=${rootContentDetails.rootContentId}`;
  }

  // 최신 page/folder URL은 쿼리와 해시를 저장하지 않는다.
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
