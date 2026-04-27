import { buildBasicAuthorizationHeader, buildConfluenceApiUrl, getConfluenceApiBaseUrl } from "./authentication";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";
import type { RequestUrlParam } from "obsidian";

export type ConfluencePageTreeFailureReason =
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "network-error"
  | "invalid-response"
  | "api-error";

export type ConfluencePageTreePageErrorReason =
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "network-error"
  | "invalid-response"
  | "api-error";

export interface ConfluencePageTreePage {
  pageId: string;
  title: string;
  parentId: string | null;
  versionNumber: number;
  sourceUrl: string;
  depth: number;
  childPosition: number;
}

export interface ConfluencePageTreeNode extends ConfluencePageTreePage {
  children: ConfluencePageTreeNode[];
}

export interface ConfluencePageTreeError {
  pageId: string;
  title: string | null;
  reason: ConfluencePageTreePageErrorReason;
  message: string;
}

export interface ConfluencePageTreeSuccess {
  ok: true;
  root: ConfluencePageTreeNode;
  pages: ConfluencePageTreePage[];
  errors: ConfluencePageTreeError[];
}

export interface ConfluencePageTreeFailure {
  ok: false;
  reason: ConfluencePageTreeFailureReason;
  message: string;
}

export type ConfluencePageTreeResult = ConfluencePageTreeSuccess | ConfluencePageTreeFailure;

interface PageDetailApiResponse {
  id?: unknown;
  title?: unknown;
  version?: {
    number?: unknown;
  } | null;
  _links?: {
    webui?: unknown;
  } | null;
}

interface DescendantsApiResponse {
  results?: unknown;
  _links?: {
    next?: unknown;
  } | null;
}

interface DescendantPageSummary {
  id: string;
  title: string;
  type: string;
  parentId: string;
  depth: number;
  childPosition: number;
}

interface DescendantPageFetchResult {
  pages: ConfluencePageTreePage[];
  errors: ConfluencePageTreeError[];
}

interface PageTreeBuildResult {
  root: ConfluencePageTreeNode;
  errors: ConfluencePageTreeError[];
}

function createAuthorizationHeader(settings: ConfluenceSyncSettings): string {
  return buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken);
}

function createPageDetailRequest(settings: ConfluenceSyncSettings, pageId: string) {
  return {
    url: buildConfluenceApiUrl(settings.confluenceBaseUrl, `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function createConfluenceGetRequest(settings: ConfluenceSyncSettings, apiPath: string) {
  return {
    url: buildConfluenceApiUrl(settings.confluenceBaseUrl, apiPath),
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: createAuthorizationHeader(settings)
    }
  };
}

function buildApiErrorMessage(status: number): string {
  return `Confluence API 오류가 발생했습니다. HTTP ${status}`;
}

function buildFailure(reason: ConfluencePageTreeFailureReason, message: string): ConfluencePageTreeFailure {
  return { ok: false, reason, message };
}

function buildPageTreeError(
  pageId: string,
  title: string | null,
  reason: ConfluencePageTreePageErrorReason,
  message: string
): ConfluencePageTreeError {
  return { pageId, title, reason, message };
}

function isPageTreeFailure(value: unknown): value is ConfluencePageTreeFailure {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "ok" in value && value.ok === false;
}

function classifyHttpFailure(status: number): ConfluencePageTreeFailure {
  if (status === 401) {
    return buildFailure(
      "authentication-failed",
      "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    );
  }

  if (status === 403) {
    return buildFailure("permission-denied", "페이지 트리에 접근할 권한이 없습니다.");
  }

  if (status === 404) {
    return buildFailure("not-found", "페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요.");
  }

  return buildFailure("api-error", buildApiErrorMessage(status));
}

function classifyRootPageHttpFailure(status: number): ConfluencePageTreeFailure {
  if (status === 404) {
    return buildFailure("not-found", "Confluence 루트 페이지를 찾을 수 없습니다.");
  }

  return classifyHttpFailure(status);
}

function classifyDescendantPageHttpError(summary: DescendantPageSummary, status: number): ConfluencePageTreeError {
  if (status === 401) {
    return buildPageTreeError(
      summary.id,
      summary.title,
      "authentication-failed",
      "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    );
  }

  if (status === 403) {
    return buildPageTreeError(
      summary.id,
      summary.title,
      "permission-denied",
      "Confluence 페이지 트리에 접근할 권한이 없습니다."
    );
  }

  if (status === 404) {
    return buildPageTreeError(
      summary.id,
      summary.title,
      "not-found",
      "Confluence 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    );
  }

  return buildPageTreeError(summary.id, summary.title, "api-error", buildApiErrorMessage(status));
}

function toDescendantPageRequestError(
  summary: DescendantPageSummary,
  failure: ConfluencePageTreeFailure
): ConfluencePageTreeError {
  if (failure.reason === "network-error") {
    return buildPageTreeError(
      summary.id,
      summary.title,
      "network-error",
      "네트워크 오류로 Confluence 페이지를 조회할 수 없습니다."
    );
  }

  return buildPageTreeError(summary.id, summary.title, failure.reason, failure.message);
}

function isPageDetailApiResponse(value: unknown): value is PageDetailApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as PageDetailApiResponse;

  if (typeof response.id !== "string" || typeof response.title !== "string") {
    return false;
  }

  if (typeof response.version !== "object" || response.version === null) {
    return false;
  }

  if (typeof response.version.number !== "number") {
    return false;
  }

  return typeof response._links === "object" || response._links === undefined || response._links === null;
}

function isDescendantsApiResponse(value: unknown): value is DescendantsApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as DescendantsApiResponse;

  return Array.isArray(response.results);
}

function isDescendantPageSummary(value: unknown): value is DescendantPageSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const summary = value as DescendantPageSummary;

  return (
    typeof summary.id === "string" &&
    typeof summary.title === "string" &&
    typeof summary.type === "string" &&
    typeof summary.parentId === "string" &&
    typeof summary.depth === "number" &&
    typeof summary.childPosition === "number"
  );
}

function isDescendantResultWithType(value: unknown): value is { type: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as { type?: unknown }).type === "string";
}

function buildSourceUrl(settings: ConfluenceSyncSettings, pageId: string, links: PageDetailApiResponse["_links"]): string {
  const webuiPath = links?.webui;

  if (typeof webuiPath === "string" && webuiPath.length > 0) {
    return new URL(webuiPath, getConfluenceApiBaseUrl(settings.confluenceBaseUrl)).toString();
  }

  const apiBaseUrl = getConfluenceApiBaseUrl(settings.confluenceBaseUrl);

  return new URL(`/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`, apiBaseUrl).toString();
}

function toRootPage(settings: ConfluenceSyncSettings, response: PageDetailApiResponse): ConfluencePageTreePage {
  return {
    pageId: response.id as string,
    title: response.title as string,
    parentId: null,
    versionNumber: response.version?.number as number,
    sourceUrl: buildSourceUrl(settings, response.id as string, response._links),
    depth: 0,
    childPosition: 0
  };
}

async function requestConfluence(
  transport: ConfluenceRequestTransport,
  request: RequestUrlParam
): Promise<ConfluenceRequestResult | ConfluencePageTreeFailure> {
  try {
    return await transport(request);
  } catch {
    return buildFailure("network-error", "네트워크 오류로 Confluence 페이지 트리를 조회할 수 없습니다.");
  }
}

function toApiPath(settings: ConfluenceSyncSettings, rawNextLink: string): ConfluencePageTreeFailure | string {
  try {
    const baseUrl = getConfluenceApiBaseUrl(settings.confluenceBaseUrl);
    const parsedUrl = new URL(rawNextLink, baseUrl);

    if (parsedUrl.origin !== new URL(baseUrl).origin) {
      return buildFailure("invalid-response", "다른 origin의 pagination URL은 사용할 수 없습니다.");
    }

    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return buildFailure("invalid-response", "Confluence pagination URL 형식이 올바르지 않습니다.");
  }
}

function readNextLink(response: DescendantsApiResponse): string | null {
  if (typeof response._links?.next !== "string" || response._links.next.trim().length === 0) {
    return null;
  }

  return response._links.next;
}

function toDescendantPageSummaries(response: DescendantsApiResponse): DescendantPageSummary[] | ConfluencePageTreeFailure {
  const summaries: DescendantPageSummary[] = [];

  for (const result of response.results ?? []) {
    if (!isDescendantResultWithType(result)) {
      return buildFailure("invalid-response", "Confluence 하위 페이지 목록 형식이 올바르지 않습니다.");
    }

    // MVP에서는 page 외 descendants를 동기화 대상에서 제외한다.
    if (result.type !== "page") {
      continue;
    }

    if (!isDescendantPageSummary(result)) {
      return buildFailure("invalid-response", "Confluence 하위 페이지 목록 형식이 올바르지 않습니다.");
    }

    summaries.push(result);
  }

  return summaries;
}

async function fetchDescendantPageSummaries(
  settings: ConfluenceSyncSettings,
  rootPageId: string,
  transport: ConfluenceRequestTransport
): Promise<DescendantPageSummary[] | ConfluencePageTreeFailure> {
  const summaries: DescendantPageSummary[] = [];
  let nextRequestPath: string | null = `/wiki/api/v2/pages/${encodeURIComponent(rootPageId)}/descendants?limit=100`;

  while (nextRequestPath !== null) {
    const descendantsResponse = await requestConfluence(
      transport,
      createConfluenceGetRequest(settings, nextRequestPath)
    );

    if (isPageTreeFailure(descendantsResponse)) {
      return descendantsResponse;
    }

    if (descendantsResponse.status !== 200) {
      return classifyHttpFailure(descendantsResponse.status);
    }

    if (!isDescendantsApiResponse(descendantsResponse.json)) {
      return buildFailure("invalid-response", "Confluence descendants 응답 형식이 올바르지 않습니다.");
    }

    const pageSummaries = toDescendantPageSummaries(descendantsResponse.json);

    if (isPageTreeFailure(pageSummaries)) {
      return pageSummaries;
    }

    summaries.push(...pageSummaries);

    const rawNextLink = readNextLink(descendantsResponse.json);

    if (rawNextLink === null) {
      nextRequestPath = null;
      continue;
    }

    const nextApiPath = toApiPath(settings, rawNextLink);

    if (isPageTreeFailure(nextApiPath)) {
      return nextApiPath;
    }

    nextRequestPath = nextApiPath;
  }

  return summaries;
}

function toDescendantPage(
  settings: ConfluenceSyncSettings,
  summary: DescendantPageSummary,
  detail: PageDetailApiResponse
): ConfluencePageTreePage {
  return {
    pageId: detail.id as string,
    title: detail.title as string,
    parentId: summary.parentId,
    versionNumber: detail.version?.number as number,
    sourceUrl: buildSourceUrl(settings, detail.id as string, detail._links),
    depth: summary.depth,
    childPosition: summary.childPosition
  };
}

async function fetchDescendantPages(
  settings: ConfluenceSyncSettings,
  summaries: DescendantPageSummary[],
  transport: ConfluenceRequestTransport
): Promise<DescendantPageFetchResult> {
  const pages: ConfluencePageTreePage[] = [];
  const errors: ConfluencePageTreeError[] = [];

  for (const summary of summaries) {
    const detailResponse = await requestConfluence(transport, createPageDetailRequest(settings, summary.id));

    if (isPageTreeFailure(detailResponse)) {
      errors.push(toDescendantPageRequestError(summary, detailResponse));
      continue;
    }

    if (detailResponse.status !== 200) {
      errors.push(classifyDescendantPageHttpError(summary, detailResponse.status));
      continue;
    }

    if (!isPageDetailApiResponse(detailResponse.json)) {
      errors.push(
        buildPageTreeError(
          summary.id,
          summary.title,
          "invalid-response",
          `Confluence 하위 페이지(${summary.id}) 응답 형식이 올바르지 않습니다.`
        )
      );
      continue;
    }

    pages.push(toDescendantPage(settings, summary, detailResponse.json));
  }

  return { pages, errors };
}

function buildPageTree(rootPage: ConfluencePageTreePage, descendantPages: ConfluencePageTreePage[]): PageTreeBuildResult {
  const rootNode: ConfluencePageTreeNode = {
    ...rootPage,
    children: []
  };
  const errors: ConfluencePageTreeError[] = [];
  const nodesByPageId = new Map<string, ConfluencePageTreeNode>([[rootNode.pageId, rootNode]]);

  for (const page of descendantPages) {
    nodesByPageId.set(page.pageId, {
      ...page,
      children: []
    });
  }

  for (const page of descendantPages) {
    const node = nodesByPageId.get(page.pageId);
    const parentNode = nodesByPageId.get(page.parentId ?? "");

    if (node === undefined) {
      continue;
    }

    if (parentNode === undefined) {
      errors.push(
        buildPageTreeError(
          page.pageId,
          page.title,
          "invalid-response",
          `Confluence 페이지(${page.pageId})의 부모(${page.parentId ?? "unknown"})를 페이지 트리에 연결할 수 없습니다.`
        )
      );
      continue;
    }

    parentNode.children.push(node);
  }

  sortPageTreeChildren(rootNode);

  return { root: rootNode, errors };
}

function sortPageTreeChildren(node: ConfluencePageTreeNode): void {
  node.children.sort((leftPage, rightPage) => leftPage.childPosition - rightPage.childPosition);

  for (const child of node.children) {
    sortPageTreeChildren(child);
  }
}

export async function fetchConfluencePageTree(
  settings: ConfluenceSyncSettings,
  rootPageId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluencePageTreeResult> {
  const rootDetailResponse = await requestConfluence(transport, createPageDetailRequest(settings, rootPageId));

  if (isPageTreeFailure(rootDetailResponse)) {
    return rootDetailResponse;
  }

  if (rootDetailResponse.status !== 200) {
    return classifyRootPageHttpFailure(rootDetailResponse.status);
  }

  if (!isPageDetailApiResponse(rootDetailResponse.json)) {
    return buildFailure("invalid-response", "Confluence 루트 페이지 응답 형식이 올바르지 않습니다.");
  }

  const rootPage = toRootPage(settings, rootDetailResponse.json);
  const descendantSummaries = await fetchDescendantPageSummaries(settings, rootPageId, transport);

  if (isPageTreeFailure(descendantSummaries)) {
    return descendantSummaries;
  }

  const descendantPages = await fetchDescendantPages(settings, descendantSummaries, transport);

  const pageTree = buildPageTree(rootPage, descendantPages.pages);

  return {
    ok: true,
    root: pageTree.root,
    pages: [rootPage, ...descendantPages.pages],
    errors: [...descendantPages.errors, ...pageTree.errors]
  };
}
