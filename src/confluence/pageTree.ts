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

export type ConfluenceRootContentType = "page" | "folder";

export type ConfluenceFolderContentTreeNode = ConfluenceFolderPageTreeNode | ConfluenceFolderTreeNode;

export interface ConfluenceFolderPageTreeNode extends ConfluencePageTreePage {
  children: ConfluenceFolderContentTreeNode[];
}

export interface ConfluenceFolderTreeNode {
  nodeType: "folder";
  contentId: string;
  title: string;
  parentId: string | null;
  depth: number;
  childPosition: number;
  children: ConfluenceFolderContentTreeNode[];
}

export interface ConfluenceFolderTreeSuccess {
  ok: true;
  root: ConfluenceFolderTreeNode;
  pages: ConfluencePageTreePage[];
  errors: ConfluencePageTreeError[];
}

export type ConfluenceFolderTreeResult = ConfluenceFolderTreeSuccess | ConfluencePageTreeFailure;
export type ConfluenceRootContentTreeResult = ConfluencePageTreeResult | ConfluenceFolderTreeResult;

const DESCENDANTS_PAGE_LIMIT = 100;
const DESCENDANTS_MAX_DEPTH = 10;

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
  results?: unknown[];
  _links?: {
    next?: unknown;
  } | null;
}

interface BaseDescendantContentSummary {
  id: string;
  title: string;
  parentId: string;
  depth: number;
  childPosition: number;
}

interface DescendantPageSummary extends BaseDescendantContentSummary {
  type: "page";
}

interface DescendantFolderSummary extends BaseDescendantContentSummary {
  type: "folder";
}

type DescendantContentSummary = DescendantPageSummary | DescendantFolderSummary;

type DescendantsContainerType = "page" | "folder";

interface DescendantsFetchRoot {
  contentType: DescendantsContainerType;
  contentId: string;
  depthOffset: number;
}

const DESCENDANTS_API_COLLECTION_BY_TYPE: Record<DescendantsContainerType, "pages" | "folders"> = {
  page: "pages",
  folder: "folders"
};

interface DescendantPageFetchResult {
  pages: ConfluencePageTreePage[];
  errors: ConfluencePageTreeError[];
}

interface PageTreeBuildResult {
  root: ConfluencePageTreeNode;
  errors: ConfluencePageTreeError[];
}

interface FolderTreeBuildResult {
  root: ConfluenceFolderTreeNode;
  errors: ConfluencePageTreeError[];
  reachableContentIds: Set<string>;
}

type OrderedDescendantContentSummary = DescendantContentSummary & { originalIndex: number };

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
    summary.type === "page" &&
    typeof summary.parentId === "string" &&
    typeof summary.depth === "number" &&
    typeof summary.childPosition === "number"
  );
}

function isDescendantContentSummary(value: unknown): value is DescendantContentSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const summary = value as DescendantContentSummary;

  return (
    typeof summary.id === "string" &&
    typeof summary.title === "string" &&
    (summary.type === "page" || summary.type === "folder") &&
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

function buildDescendantsRequestPath(root: DescendantsFetchRoot): string {
  const collectionName = DESCENDANTS_API_COLLECTION_BY_TYPE[root.contentType];

  return `/wiki/api/v2/${collectionName}/${encodeURIComponent(root.contentId)}/descendants?limit=${DESCENDANTS_PAGE_LIMIT}&depth=${DESCENDANTS_MAX_DEPTH}`;
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

function toDescendantContentSummaries(
  response: DescendantsApiResponse
): DescendantContentSummary[] | ConfluencePageTreeFailure {
  const summaries: DescendantContentSummary[] = [];

  for (const result of response.results ?? []) {
    if (!isDescendantResultWithType(result)) {
      return buildFailure("invalid-response", "Confluence 하위 콘텐츠 목록 형식이 올바르지 않습니다.");
    }

    // Folder root에서는 구조 보존에 필요한 page/folder만 사용한다.
    if (result.type !== "page" && result.type !== "folder") {
      continue;
    }

    if (!isDescendantContentSummary(result)) {
      return buildFailure("invalid-response", "Confluence 하위 콘텐츠 목록 형식이 올바르지 않습니다.");
    }

    summaries.push(result);
  }

  return summaries;
}

async function fetchDescendantSummariesForRoot<TSummary extends BaseDescendantContentSummary>(
  settings: ConfluenceSyncSettings,
  root: DescendantsFetchRoot,
  transport: ConfluenceRequestTransport,
  toSummaries: (response: DescendantsApiResponse) => TSummary[] | ConfluencePageTreeFailure
): Promise<TSummary[] | ConfluencePageTreeFailure> {
  const summaries: TSummary[] = [];
  let nextRequestPath: string | null = buildDescendantsRequestPath(root);

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

    const pageSummaries = toSummaries(descendantsResponse.json);

    if (isPageTreeFailure(pageSummaries)) {
      return pageSummaries;
    }

    summaries.push(
      ...pageSummaries.map((summary) => ({
        ...summary,
        depth: summary.depth + root.depthOffset
      }))
    );

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

async function fetchDescendantPageSummaries(
  settings: ConfluenceSyncSettings,
  rootPageId: string,
  transport: ConfluenceRequestTransport
): Promise<DescendantPageSummary[] | ConfluencePageTreeFailure> {
  const summariesByPageId = new Map<string, DescendantPageSummary>();
  const expandedRootKeys = new Set<string>();
  const pendingRoots: DescendantsFetchRoot[] = [{ contentType: "page", contentId: rootPageId, depthOffset: 0 }];

  while (pendingRoots.length > 0) {
    const root = pendingRoots.shift();

    if (root === undefined) {
      continue;
    }

    const rootKey = `${root.contentType}:${root.contentId}`;

    if (expandedRootKeys.has(rootKey)) {
      continue;
    }

    expandedRootKeys.add(rootKey);
    const pageSummaries = await fetchDescendantSummariesForRoot(settings, root, transport, toDescendantPageSummaries);

    if (isPageTreeFailure(pageSummaries)) {
      return pageSummaries;
    }

    for (const summary of pageSummaries) {
      if (summariesByPageId.has(summary.id)) {
        continue;
      }

      summariesByPageId.set(summary.id, summary);

      if (summary.depth - root.depthOffset === DESCENDANTS_MAX_DEPTH) {
        pendingRoots.push({ contentType: "page", contentId: summary.id, depthOffset: summary.depth });
      }
    }
  }

  return [...summariesByPageId.values()];
}

async function fetchFolderDescendantContentSummaries(
  settings: ConfluenceSyncSettings,
  rootFolderId: string,
  transport: ConfluenceRequestTransport
): Promise<DescendantContentSummary[] | ConfluencePageTreeFailure> {
  const summaries: DescendantContentSummary[] = [];
  let nextRequestPath: string | null =
    `/wiki/api/v2/folders/${encodeURIComponent(rootFolderId)}/descendants?limit=${DESCENDANTS_PAGE_LIMIT}&depth=${DESCENDANTS_MAX_DEPTH}`;

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

    const contentSummaries = toDescendantContentSummaries(descendantsResponse.json);

    if (isPageTreeFailure(contentSummaries)) {
      return contentSummaries;
    }

    summaries.push(...contentSummaries);

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

function toRootFolder(settings: ConfluenceSyncSettings, rootFolderId: string): ConfluenceFolderTreeNode {
  const currentProject = settings.currentProject;
  const title =
    currentProject?.rootContentType === "folder" && currentProject.rootContentId === rootFolderId
      ? currentProject.projectName
      : `Confluence Folder ${rootFolderId}`;

  return {
    nodeType: "folder",
    contentId: rootFolderId,
    title,
    parentId: null,
    depth: 0,
    childPosition: 0,
    children: []
  };
}

function toFolderTreeNode(summary: DescendantFolderSummary): ConfluenceFolderTreeNode {
  return {
    nodeType: "folder",
    contentId: summary.id,
    title: summary.title,
    parentId: summary.parentId,
    depth: summary.depth,
    childPosition: summary.childPosition,
    children: []
  };
}

function isFolderContentPageNode(node: ConfluenceFolderContentTreeNode): node is ConfluenceFolderPageTreeNode {
  return "pageId" in node;
}

function getFolderContentNodeId(node: ConfluenceFolderContentTreeNode): string {
  return isFolderContentPageNode(node) ? node.pageId : node.contentId;
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

function buildFolderContentTree(
  rootNode: ConfluenceFolderTreeNode,
  orderedDescendants: OrderedDescendantContentSummary[],
  descendantPages: ConfluencePageTreePage[]
): FolderTreeBuildResult {
  const rootNodeWithChildren: ConfluenceFolderTreeNode = {
    ...rootNode,
    children: []
  };
  const errors: ConfluencePageTreeError[] = [];
  const nodesByContentId = new Map<string, ConfluenceFolderContentTreeNode>([
    [rootNodeWithChildren.contentId, rootNodeWithChildren]
  ]);
  const originalIndexesByContentId = new Map<string, number>([[rootNodeWithChildren.contentId, -1]]);
  const erroredContentIds = new Set<string>();

  for (const summary of orderedDescendants) {
    originalIndexesByContentId.set(summary.id, summary.originalIndex);

    if (summary.type === "folder") {
      const folderNode = toFolderTreeNode(summary);
      nodesByContentId.set(folderNode.contentId, folderNode);
      continue;
    }

    const page = descendantPages.find((candidate) => candidate.pageId === summary.id);

    if (page !== undefined) {
      nodesByContentId.set(page.pageId, {
        ...page,
        children: []
      });
    }
  }

  const childNodes = orderedDescendants.map((summary) => nodesByContentId.get(summary.id));

  for (const node of childNodes) {
    if (node === undefined) {
      continue;
    }

    const parentNode = nodesByContentId.get(node.parentId ?? "");

    if (parentNode === undefined) {
      const contentId = getFolderContentNodeId(node);
      erroredContentIds.add(contentId);
      errors.push(
        buildPageTreeError(
          contentId,
          node.title,
          "invalid-response",
          `Confluence 콘텐츠(${contentId})의 부모(${node.parentId ?? "unknown"})를 페이지 트리에 연결할 수 없습니다.`
        )
      );
      continue;
    }

    parentNode.children.push(node);
  }

  sortFolderContentTreeChildren(rootNodeWithChildren, originalIndexesByContentId);
  const reachableContentIds = collectReachableFolderContentIds(rootNodeWithChildren);

  for (const [contentId, node] of nodesByContentId) {
    if (contentId === rootNodeWithChildren.contentId || reachableContentIds.has(contentId) || erroredContentIds.has(contentId)) {
      continue;
    }

    errors.push(
      buildPageTreeError(
        contentId,
        node.title,
        "invalid-response",
        `Confluence 콘텐츠(${contentId})는 루트 폴더(${rootNodeWithChildren.contentId})에서 도달할 수 없습니다.`
      )
    );
  }

  return { root: rootNodeWithChildren, errors, reachableContentIds };
}

function collectReachableFolderContentIds(rootNode: ConfluenceFolderContentTreeNode): Set<string> {
  const reachableContentIds = new Set<string>();
  const pendingNodes: ConfluenceFolderContentTreeNode[] = [rootNode];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();

    if (node === undefined) {
      continue;
    }

    reachableContentIds.add(getFolderContentNodeId(node));
    pendingNodes.push(...node.children);
  }

  return reachableContentIds;
}

function sortFolderContentTreeChildren(
  node: ConfluenceFolderContentTreeNode,
  originalIndexesByContentId: Map<string, number>
): void {
  node.children.sort((leftNode, rightNode) => {
    const childPositionDifference = leftNode.childPosition - rightNode.childPosition;

    if (childPositionDifference !== 0) {
      return childPositionDifference;
    }

    return (
      (originalIndexesByContentId.get(getFolderContentNodeId(leftNode)) ?? 0) -
      (originalIndexesByContentId.get(getFolderContentNodeId(rightNode)) ?? 0)
    );
  });

  for (const child of node.children) {
    sortFolderContentTreeChildren(child, originalIndexesByContentId);
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

export async function fetchConfluenceFolderTree(
  settings: ConfluenceSyncSettings,
  rootFolderId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceFolderTreeResult> {
  const rootNode = toRootFolder(settings, rootFolderId);
  const descendantSummaries = await fetchFolderDescendantContentSummaries(settings, rootFolderId, transport);

  if (isPageTreeFailure(descendantSummaries)) {
    return descendantSummaries;
  }

  const orderedDescendants = descendantSummaries.map((summary, originalIndex) => ({
    ...summary,
    originalIndex
  }));
  const descendantPageSummaries = orderedDescendants.filter(
    (summary): summary is DescendantPageSummary & OrderedDescendantContentSummary => summary.type === "page"
  );
  const descendantPages = await fetchDescendantPages(settings, descendantPageSummaries, transport);
  const folderTree = buildFolderContentTree(rootNode, orderedDescendants, descendantPages.pages);
  const reachablePages = descendantPages.pages.filter((page) => folderTree.reachableContentIds.has(page.pageId));

  return {
    ok: true,
    root: folderTree.root,
    pages: reachablePages,
    errors: [...descendantPages.errors, ...folderTree.errors]
  };
}

export async function fetchConfluenceRootContentTree(
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string,
  transport: ConfluenceRequestTransport
): Promise<ConfluenceRootContentTreeResult> {
  if (rootContentType === "page") {
    return fetchConfluencePageTree(settings, rootContentId, transport);
  }

  return fetchConfluenceFolderTree(settings, rootContentId, transport);
}
