import { buildBasicAuthorizationHeader, buildConfluenceApiUrl, getConfluenceApiBaseUrl } from "./authentication";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";
import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";

const ATTACHMENTS_PAGE_LIMIT = 250;
const HTML_ATTACHMENT_ACCEPT_HEADER = "text/html,application/xhtml+xml,*/*";

export type ConfluenceHtmlAttachmentIssueReason =
  | "network-error"
  | "api-error"
  | "invalid-response"
  | "invalid-download-link";

export interface ConfluenceHtmlAttachmentIssue {
  pageId: string;
  pageTitle: string;
  attachmentId: string | null;
  attachmentTitle: string | null;
  reason: ConfluenceHtmlAttachmentIssueReason;
  message: string;
}

export interface ConfluenceHtmlAttachment {
  id: string;
  pageId: string;
  pageTitle: string;
  title: string;
  mediaType: string | null;
  fileSize: number | null;
  downloadLink: string;
  versionNumber: number | null;
}

export interface FetchConfluencePageHtmlAttachmentsResult {
  attachments: ConfluenceHtmlAttachment[];
  issues: ConfluenceHtmlAttachmentIssue[];
}

export type DownloadConfluenceHtmlAttachmentResult =
  | { ok: true; html: string }
  | { ok: false; issue: ConfluenceHtmlAttachmentIssue };

interface AttachmentsApiResponse {
  results?: unknown;
  _links?: {
    next?: unknown;
  } | null;
}

interface AttachmentApiResult {
  id?: unknown;
  status?: unknown;
  title?: unknown;
  pageId?: unknown;
  mediaType?: unknown;
  fileSize?: unknown;
  downloadLink?: unknown;
  version?: {
    number?: unknown;
  } | null;
}

export async function fetchConfluencePageHtmlAttachments(
  settings: ConfluenceSyncSettings,
  pageId: string,
  pageTitle: string,
  transport: ConfluenceRequestTransport
): Promise<FetchConfluencePageHtmlAttachmentsResult> {
  const attachments: ConfluenceHtmlAttachment[] = [];
  const issues: ConfluenceHtmlAttachmentIssue[] = [];
  const requestedUrls = new Set<string>();
  const initialSearchParams = new URLSearchParams({
    limit: String(ATTACHMENTS_PAGE_LIMIT),
    status: "current",
    mediaType: "text/html"
  });
  let nextUrl: string | null = buildConfluenceApiUrl(
    settings.confluenceBaseUrl,
    `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments?${initialSearchParams.toString()}`
  );

  while (nextUrl !== null) {
    requestedUrls.add(nextUrl);

    const response = await requestConfluence(transport, {
      url: nextUrl,
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken)
      }
    });

    if (response instanceof Error) {
      issues.push(createIssue(pageId, pageTitle, null, null, "network-error", "네트워크 오류로 Confluence HTML 첨부 목록을 조회할 수 없습니다."));
      break;
    }

    if (response.status !== 200) {
      issues.push(createIssue(pageId, pageTitle, null, null, "api-error", `Confluence HTML 첨부 목록 조회 중 API 오류가 발생했습니다. HTTP ${response.status}`));
      break;
    }

    if (!isAttachmentsApiResponse(response.json) || !Array.isArray(response.json.results)) {
      issues.push(createIssue(pageId, pageTitle, null, null, "invalid-response", "Confluence HTML 첨부 목록 응답 형식이 올바르지 않습니다."));
      break;
    }

    for (const rawAttachment of response.json.results) {
      const attachment = toHtmlAttachment(rawAttachment, pageTitle);

      if (attachment !== null) {
        attachments.push(attachment);
      }
    }

    const rawNextLink = readNextLink(response.json);

    if (rawNextLink === null) {
      nextUrl = null;
      continue;
    }

    const resolvedNextUrl = resolveSameOriginUrl(settings.confluenceBaseUrl, rawNextLink);

    if (resolvedNextUrl === null) {
      issues.push(createIssue(pageId, pageTitle, null, null, "invalid-response", "Confluence HTML 첨부 목록의 다음 페이지 링크 형식이 올바르지 않습니다."));
      break;
    }

    if (requestedUrls.has(resolvedNextUrl)) {
      issues.push(createIssue(pageId, pageTitle, null, null, "invalid-response", "Confluence HTML 첨부 목록의 다음 페이지 링크가 이미 처리된 URL을 가리킵니다."));
      break;
    }

    nextUrl = resolvedNextUrl;
  }

  return { attachments, issues };
}

export async function downloadConfluenceHtmlAttachment(
  settings: ConfluenceSyncSettings,
  attachment: ConfluenceHtmlAttachment,
  transport: ConfluenceRequestTransport
): Promise<DownloadConfluenceHtmlAttachmentResult> {
  const downloadUrl = resolveSameOriginUrl(settings.confluenceBaseUrl, attachment.downloadLink);

  if (downloadUrl === null) {
    return {
      ok: false,
      issue: createAttachmentIssue(
        attachment,
        "invalid-download-link",
        "Confluence HTML 첨부 다운로드 링크가 base URL과 다른 origin을 가리킵니다."
      )
    };
  }

  const response = await requestConfluence(transport, {
    url: downloadUrl,
    method: "GET",
    headers: {
      Accept: HTML_ATTACHMENT_ACCEPT_HEADER,
      Authorization: buildBasicAuthorizationHeader(settings.userEmail, settings.apiToken)
    }
  });

  if (response instanceof Error) {
    return {
      ok: false,
      issue: createAttachmentIssue(attachment, "network-error", "네트워크 오류로 Confluence HTML 첨부를 다운로드할 수 없습니다.")
    };
  }

  if (response.status !== 200) {
    return {
      ok: false,
      issue: createAttachmentIssue(attachment, "api-error", `Confluence HTML 첨부 다운로드 중 API 오류가 발생했습니다. HTTP ${response.status}`)
    };
  }

  const html = decodeResponseBody(response);

  if (html === null) {
    return {
      ok: false,
      issue: createAttachmentIssue(attachment, "invalid-response", "Confluence HTML 첨부 다운로드 응답 본문이 비어 있습니다.")
    };
  }

  return { ok: true, html };
}

async function requestConfluence(
  transport: ConfluenceRequestTransport,
  request: Parameters<ConfluenceRequestTransport>[0]
): Promise<ConfluenceRequestResult | Error> {
  try {
    return await transport(request);
  } catch (error) {
    return error instanceof Error ? error : new Error("Confluence request failed");
  }
}

function toHtmlAttachment(rawAttachment: unknown, pageTitle: string): ConfluenceHtmlAttachment | null {
  if (!isAttachmentApiResult(rawAttachment)) {
    return null;
  }

  if (rawAttachment.status !== "current" || !rawAttachment.title.endsWith(".html")) {
    return null;
  }

  return {
    id: rawAttachment.id,
    pageId: rawAttachment.pageId,
    pageTitle,
    title: rawAttachment.title,
    mediaType: rawAttachment.mediaType,
    fileSize: rawAttachment.fileSize,
    downloadLink: rawAttachment.downloadLink,
    versionNumber: rawAttachment.version?.number ?? null
  };
}

function isAttachmentApiResult(value: unknown): value is {
  id: string;
  status: string;
  title: string;
  pageId: string;
  mediaType: string | null;
  fileSize: number | null;
  downloadLink: string;
  version?: {
    number?: number;
  } | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const attachment = value as AttachmentApiResult;
  const mediaType = attachment.mediaType ?? null;
  const fileSize = attachment.fileSize ?? null;
  const versionNumber = attachment.version?.number ?? null;

  if (
    typeof attachment.id !== "string" ||
    typeof attachment.status !== "string" ||
    typeof attachment.title !== "string" ||
    typeof attachment.pageId !== "string" ||
    typeof attachment.downloadLink !== "string"
  ) {
    return false;
  }

  if (mediaType !== null && typeof mediaType !== "string") {
    return false;
  }

  if (fileSize !== null && typeof fileSize !== "number") {
    return false;
  }

  return versionNumber === null || typeof versionNumber === "number";
}

function isAttachmentsApiResponse(value: unknown): value is AttachmentsApiResponse {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNextLink(response: AttachmentsApiResponse): string | null {
  if (typeof response._links?.next !== "string" || response._links.next.trim().length === 0) {
    return null;
  }

  return response._links.next;
}

function resolveSameOriginUrl(baseUrl: string, rawUrl: string): string | null {
  try {
    const apiBaseUrl = getConfluenceApiBaseUrl(baseUrl);
    const parsedUrl = new URL(rawUrl, apiBaseUrl);

    if (parsedUrl.origin !== new URL(apiBaseUrl).origin) {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function decodeResponseBody(response: ConfluenceRequestResult): string | null {
  if (typeof response.text === "string") {
    return response.text;
  }

  if (response.arrayBuffer instanceof ArrayBuffer) {
    return new TextDecoder("utf-8").decode(response.arrayBuffer);
  }

  return null;
}

function createAttachmentIssue(
  attachment: ConfluenceHtmlAttachment,
  reason: ConfluenceHtmlAttachmentIssueReason,
  message: string
): ConfluenceHtmlAttachmentIssue {
  return createIssue(attachment.pageId, attachment.pageTitle, attachment.id, attachment.title, reason, message);
}

function createIssue(
  pageId: string,
  pageTitle: string,
  attachmentId: string | null,
  attachmentTitle: string | null,
  reason: ConfluenceHtmlAttachmentIssueReason,
  message: string
): ConfluenceHtmlAttachmentIssue {
  return { pageId, pageTitle, attachmentId, attachmentTitle, reason, message };
}
