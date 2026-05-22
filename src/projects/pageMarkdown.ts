import { createHash } from "crypto";
import type { ConfluenceHtmlAttachment } from "../confluence/attachments";
import type {
  ConfluenceFolderContentTreeNode,
  ConfluencePageTreeNode,
  ConfluencePageTreePage,
} from "../confluence/pageTree";
import {
  convertConfluenceStorageToMarkdown,
  type ConfluenceStorageToMarkdownWarning,
} from "../markdown/confluenceStorageToMarkdown";

const MAX_SAFE_FILE_BASE_NAME_LENGTH = 120;
const MARKDOWN_FILE_EXTENSION = ".md";
const HTML_FILE_EXTENSION = ".html";
const UNSAFE_MARKDOWN_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]+/gu;
const TRAILING_DOT_OR_SPACE = /[. ]+$/u;
const WINDOWS_RESERVED_FILE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export interface PageMarkdownFile {
  pageId: string;
  title: string;
  vaultPath: string;
  content: string;
  warnings: ConfluenceStorageToMarkdownWarning[];
}

export interface PageHtmlAttachmentFile {
  attachmentFileId: string;
  pageId: string;
  pageTitle: string;
  attachmentId: string;
  attachmentTitle: string;
  vaultPath: string;
  downloadLink: string;
  versionNumber: number | null;
}

export interface PageMarkdownConversionIssue {
  severity: "warning" | "error";
  pageId: string;
  title: string;
  message: string;
}

export interface BuildPageMarkdownFilesResult {
  files: PageMarkdownFile[];
  conversionIssues: PageMarkdownConversionIssue[];
  htmlAttachmentFiles: PageHtmlAttachmentFile[];
}

export type StorageToMarkdownConverter = typeof convertConfluenceStorageToMarkdown;

export interface ParsedPageMarkdownMetadata {
  pageId: string;
  versionNumber: number | null;
  contentHash: string | null;
  bodyMarkdown: string;
}

export interface BuildPageMarkdownFilesInput {
  projectRootPath: string;
  root: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode;
  pages: ConfluencePageTreePage[];
  existingPagePathById?: ReadonlyMap<string, string>;
  pathExists: (path: string) => Promise<boolean>;
  readExistingFile?: (path: string) => Promise<string>;
  convertStorageToMarkdown?: StorageToMarkdownConverter;
  htmlAttachmentsByPageId?: ReadonlyMap<string, readonly ConfluenceHtmlAttachment[]>;
  availableHtmlAttachmentFilesByPageId?: ReadonlyMap<string, readonly PageHtmlAttachmentFile[]>;
}

export interface UpdatePageMarkdownFrontmatterAfterPushInput {
  versionNumber: number;
  contentHash: string;
}

export interface CreatePageMarkdownContentInput {
  pageId: string;
  title: string;
  versionNumber: number;
  sourceUrl: string;
  parentId: string | null;
  bodyMarkdown: string;
}

export function createSafeMarkdownFileName(title: string, pageId: string): string {
  return `${createSafeFileBaseName(title, `confluence-page-${createSafePageIdSegment(pageId)}`)}${MARKDOWN_FILE_EXTENSION}`;
}

const FRONTMATTER_PATTERN = /^\s*---\n([\s\S]*?)\n---\n?/u;

export function calculateMarkdownBodyHash(markdownBody: string): string {
  return `sha256:${createHash("sha256").update(markdownBody, "utf8").digest("hex")}`;
}

export function parsePageMarkdownMetadata(markdown: string): ParsedPageMarkdownMetadata | null {
  const frontmatterMatch = markdown.match(FRONTMATTER_PATTERN);

  if (frontmatterMatch === null) {
    return null;
  }

  const frontmatter = frontmatterMatch[1] ?? "";
  const pageId =
    readQuotedFrontmatterValue(frontmatter, "confluencePageId") ??
    readQuotedFrontmatterValue(frontmatter, "pageId") ??
    readNestedConfluencePageId(frontmatter);

  if (pageId === null) {
    return null;
  }

  return {
    pageId,
    versionNumber: readNumericFrontmatterValue(frontmatter, "confluenceVersion"),
    contentHash: readQuotedFrontmatterValue(frontmatter, "confluenceContentHash"),
    bodyMarkdown: removeFrontmatterBodySeparator(markdown.slice(frontmatterMatch[0].length)),
  };
}

export function updatePageMarkdownFrontmatterAfterPush(
  markdown: string,
  input: UpdatePageMarkdownFrontmatterAfterPushInput,
): string | null {
  const frontmatterMatch = markdown.match(FRONTMATTER_PATTERN);

  if (frontmatterMatch === null) {
    return null;
  }

  const originalFrontmatter = frontmatterMatch[1] ?? "";
  const frontmatterWithVersion = upsertFrontmatterLine(
    originalFrontmatter,
    "confluenceVersion",
    String(input.versionNumber),
  );
  const updatedFrontmatter = upsertFrontmatterLine(
    frontmatterWithVersion,
    "confluenceContentHash",
    JSON.stringify(input.contentHash),
  );

  return `---\n${updatedFrontmatter}\n---\n${markdown.slice(frontmatterMatch[0].length)}`;
}

export function createPageMarkdownContent(input: CreatePageMarkdownContentInput): string {
  return `${createFrontmatter(
    {
      pageId: input.pageId,
      title: input.title,
      versionNumber: input.versionNumber,
      sourceUrl: input.sourceUrl,
      parentId: input.parentId,
      bodyStorageValue: "",
      depth: 0,
      childPosition: 0
    },
    input.bodyMarkdown
  )}\n\n${input.bodyMarkdown}`;
}

export function createDetachedPageBackupMarkdown(markdown: string): string {
  const metadata = parsePageMarkdownMetadata(markdown);
  const bodyMarkdown = metadata?.bodyMarkdown ?? markdown;

  return `# Confluence 연결이 해제된 백업본

이 파일은 Pull Current Page 실행 전에 보존한 로컬 수정본입니다. Confluence pageId, version, content hash metadata를 제거했으므로 Push/Pull 대상이 아닙니다.

${bodyMarkdown}`;
}

export function createCurrentPageBackupPath(originalPath: string, now: Date, collisionIndex: number): string {
  const timestamp = now.toISOString().replace(/[:.]/gu, "-");
  const suffix = collisionIndex === 0 ? "" : ` (${collisionIndex})`;
  const extensionIndex = originalPath.toLowerCase().endsWith(MARKDOWN_FILE_EXTENSION)
    ? originalPath.length - MARKDOWN_FILE_EXTENSION.length
    : originalPath.length;

  return `${originalPath.slice(0, extensionIndex)}.local-backup-${timestamp}${suffix}${MARKDOWN_FILE_EXTENSION}`;
}

function removeFrontmatterBodySeparator(markdownBody: string): string {
  return markdownBody.startsWith("\n") ? markdownBody.slice(1) : markdownBody;
}

export async function buildPageMarkdownFiles(input: BuildPageMarkdownFilesInput): Promise<BuildPageMarkdownFilesResult> {
  const files: PageMarkdownFile[] = [];
  const conversionIssues: PageMarkdownConversionIssue[] = [];
  const convertStorageToMarkdown = input.convertStorageToMarkdown ?? convertConfluenceStorageToMarkdown;
  const pagesById = new Map(input.pages.map((page) => [page.pageId, page]));
  const pathAssignments = new Map<string, string>();
  const reservedFilePathKeys = new Set<string>();
  const pagesToWrite = await assignTreePageMarkdownPaths(
    input,
    pagesById,
    pathAssignments,
    reservedFilePathKeys,
  );
  const placedPageIds = new Set(pagesToWrite.map((placement) => placement.page.pageId));

  for (const page of input.pages.filter((page) => !placedPageIds.has(page.pageId))) {
    const vaultPath = await createAvailableMarkdownPath(
      input.projectRootPath,
      page,
      [],
      reservedFilePathKeys,
      input.pathExists,
      input.readExistingFile,
      input.existingPagePathById,
    );
    pathAssignments.set(page.pageId, vaultPath);
    pagesToWrite.push({ page, folderSegments: [] });
  }

  const linkTargetsByTitle = buildLinkTargetsByTitle(
    pagesToWrite.map((placement) => placement.page),
    pathAssignments,
  );
  const htmlAttachmentFilesByPageId = buildHtmlAttachmentFilesByPageId(
    input.htmlAttachmentsByPageId,
    pathAssignments,
  );
  const htmlAttachmentFiles = Array.from(htmlAttachmentFilesByPageId.values()).flat();
  const availableHtmlAttachmentFilesByPageId = buildAvailableHtmlAttachmentFilesByPageId(
    input.availableHtmlAttachmentFilesByPageId,
  );

  for (const { page } of pagesToWrite) {
    const vaultPath = pathAssignments.get(page.pageId);

    if (vaultPath === undefined) {
      continue;
    }

    let markdownConversion: ReturnType<StorageToMarkdownConverter>;

    try {
      markdownConversion = convertStorageToMarkdown(page.bodyStorageValue, {
        resolvePageLinkTarget: (contentTitle) => linkTargetsByTitle.get(contentTitle) ?? contentTitle,
        resolveJiraIssueUrl: (issueKey) => createJiraIssueUrl(page.sourceUrl, issueKey),
        resolveAttachmentLinkTarget: (attachmentFileName) => {
          const availableHtmlAttachmentFiles = availableHtmlAttachmentFilesByPageId.get(page.pageId) ?? [];
          return availableHtmlAttachmentFiles.find(
            (file) => createAttachmentLookupKey(file.attachmentTitle) === createAttachmentLookupKey(attachmentFileName),
          )?.vaultPath ?? null;
        },
      });
    } catch (error) {
      const detail = error instanceof Error && error.message.length > 0 ? error.message : "알 수 없는 변환 오류";

      conversionIssues.push({
        severity: "error",
        pageId: page.pageId,
        title: page.title,
        message: `Confluence storage를 Markdown으로 변환할 수 없습니다: ${detail}`,
      });
      continue;
    }

    conversionIssues.push(
      ...markdownConversion.warnings.map((warning) => ({
        severity: "warning" as const,
        pageId: page.pageId,
        title: page.title,
        message: toConversionWarningMessage(warning),
      })),
    );

    const markdownBody = `${markdownConversion.markdown}\n`;

    files.push({
      pageId: page.pageId,
      title: page.title,
      vaultPath,
      warnings: markdownConversion.warnings,
      content: createPageMarkdownContent({
        pageId: page.pageId,
        title: page.title,
        versionNumber: page.versionNumber,
        sourceUrl: page.sourceUrl,
        parentId: page.parentId,
        bodyMarkdown: markdownBody
      }),
    });
  }

  return { files, conversionIssues, htmlAttachmentFiles };
}

function buildHtmlAttachmentFilesByPageId(
  htmlAttachmentsByPageId: ReadonlyMap<string, readonly ConfluenceHtmlAttachment[]> | undefined,
  pathAssignments: ReadonlyMap<string, string>,
): Map<string, PageHtmlAttachmentFile[]> {
  const htmlAttachmentFilesByPageId = new Map<string, PageHtmlAttachmentFile[]>();

  for (const [pageId, attachments] of htmlAttachmentsByPageId ?? []) {
    const pageVaultPath = pathAssignments.get(pageId);

    if (pageVaultPath === undefined) {
      continue;
    }

    const reservedPathKeys = new Set<string>();
    const htmlAttachmentFiles = attachments.map((attachment, index) => ({
      attachmentFileId: `${attachment.id}::${index}`,
      pageId: attachment.pageId,
      pageTitle: attachment.pageTitle,
      attachmentId: attachment.id,
      attachmentTitle: attachment.title,
      vaultPath: createAvailableHtmlAttachmentVaultPath(pageVaultPath, attachment, reservedPathKeys),
      downloadLink: attachment.downloadLink,
      versionNumber: attachment.versionNumber,
    }));

    htmlAttachmentFilesByPageId.set(pageId, htmlAttachmentFiles);
  }

  return htmlAttachmentFilesByPageId;
}

function buildAvailableHtmlAttachmentFilesByPageId(
  availableHtmlAttachmentFilesByPageId: ReadonlyMap<string, readonly PageHtmlAttachmentFile[]> | undefined,
): Map<string, PageHtmlAttachmentFile[]> {
  return new Map(
    Array.from(availableHtmlAttachmentFilesByPageId ?? [], ([pageId, files]) => [pageId, Array.from(files)]),
  );
}

function createAvailableHtmlAttachmentVaultPath(
  pageVaultPath: string,
  attachment: ConfluenceHtmlAttachment,
  reservedPathKeys: Set<string>,
): string {
  const assetsFolderPath = `${removeMarkdownExtension(pageVaultPath)}.assets`;
  const safeHtmlFileName = createSafeHtmlAttachmentFileName(attachment.title, attachment.id);
  const safeHtmlBaseName = safeHtmlFileName.slice(0, -HTML_FILE_EXTENSION.length);
  let collisionIndex = 0;

  while (true) {
    const suffix = collisionIndex === 0 ? "" : ` (${collisionIndex})`;
    const candidatePath = joinVaultPath(assetsFolderPath, `${safeHtmlBaseName}${suffix}${HTML_FILE_EXTENSION}`);
    const candidatePathKey = createReservedPathKey(candidatePath);

    if (!reservedPathKeys.has(candidatePathKey)) {
      reservedPathKeys.add(candidatePathKey);
      return candidatePath;
    }

    collisionIndex += 1;
  }
}

function createSafeHtmlAttachmentFileName(attachmentTitle: string, attachmentId: string): string {
  const rawBaseName = attachmentTitle.toLocaleLowerCase("en-US").endsWith(HTML_FILE_EXTENSION)
    ? attachmentTitle.slice(0, -HTML_FILE_EXTENSION.length)
    : attachmentTitle;
  return `${createSafeFileBaseName(rawBaseName, `confluence-attachment-${createSafePageIdSegment(attachmentId)}`)}${HTML_FILE_EXTENSION}`;
}

function createAttachmentLookupKey(attachmentTitle: string): string {
  return attachmentTitle.toLocaleLowerCase("en-US");
}

function toConversionWarningMessage(warning: ConfluenceStorageToMarkdownWarning): string {
  if (warning.type === "unsupported-macro") {
    return `지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: ${warning.name}`;
  }

  return "Confluence storage 일부가 Markdown 경고로 변환됐습니다.";
}

interface PagePlacementWithPage {
  page: ConfluencePageTreePage;
  folderSegments: string[];
}

async function assignTreePageMarkdownPaths(
  input: BuildPageMarkdownFilesInput,
  pagesById: Map<string, ConfluencePageTreePage>,
  pathAssignments: Map<string, string>,
  reservedFilePathKeys: Set<string>,
): Promise<PagePlacementWithPage[]> {
  const pagesToWrite: PagePlacementWithPage[] = [];
  const visitedNodeKeys = new Set<string>();
  const reservedFolderSegmentKeysByParentPath = new Map<string, Set<string>>();

  async function visitNode(
    node: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode,
    folderSegments: string[],
    isRoot: boolean,
  ): Promise<void> {
    const nodeKey = getTreeNodeKey(node);

    if (visitedNodeKeys.has(nodeKey)) {
      return;
    }

    visitedNodeKeys.add(nodeKey);

    let childFolderSegments = folderSegments;

    if (isPageTreeNode(node)) {
      const page = pagesById.get(node.pageId) ?? node;
      const vaultPath = await createAvailableMarkdownPath(
        input.projectRootPath,
        page,
        folderSegments,
        reservedFilePathKeys,
        input.pathExists,
        input.readExistingFile,
        input.existingPagePathById,
      );
      const childFolderSegment = getMarkdownFileBaseNameFromVaultPath(vaultPath);

      pathAssignments.set(page.pageId, vaultPath);
      pagesToWrite.push({ page, folderSegments });
      childFolderSegments = [...folderSegments, childFolderSegment];
      reserveFolderSegment(folderSegments, childFolderSegment, reservedFolderSegmentKeysByParentPath);
    } else if (!isRoot) {
      childFolderSegments = [
        ...folderSegments,
        createAvailableFolderSegment(folderSegments, node, reservedFolderSegmentKeysByParentPath),
      ];
    }

    for (const childNode of node.children) {
      await visitNode(childNode, childFolderSegments, false);
    }
  }

  await visitNode(input.root, [], true);

  return pagesToWrite;
}

function buildLinkTargetsByTitle(
  pages: ConfluencePageTreePage[],
  pathAssignments: Map<string, string>,
): Map<string, string> {
  const linkTargetsByTitle = new Map<string, string>();

  for (const page of pages) {
    if (linkTargetsByTitle.has(page.title)) {
      continue;
    }

    const vaultPath = pathAssignments.get(page.pageId);

    if (vaultPath !== undefined) {
      linkTargetsByTitle.set(page.title, removeMarkdownExtension(vaultPath));
    }
  }

  return linkTargetsByTitle;
}

function createAvailableFolderSegment(
  parentFolderSegments: string[],
  node: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode,
  reservedFolderSegmentKeysByParentPath: Map<string, Set<string>>,
): string {
  const parentKey = parentFolderSegments.join("/");
  const reservedSegmentKeys = reservedFolderSegmentKeysByParentPath.get(parentKey) ?? new Set<string>();
  reservedFolderSegmentKeysByParentPath.set(parentKey, reservedSegmentKeys);

  const fallbackId = isPageTreeNode(node) ? node.pageId : node.contentId;
  const baseSegment = createSafeFileBaseName(node.title, `confluence-content-${createSafePageIdSegment(fallbackId)}`);
  let collisionIndex = 0;

  while (true) {
    const suffix = collisionIndex === 0 ? "" : ` (${collisionIndex})`;
    const candidateSegment = `${baseSegment}${suffix}`;
    const candidateSegmentKey = candidateSegment.toLocaleLowerCase("en-US");

    if (!reservedSegmentKeys.has(candidateSegmentKey)) {
      reservedSegmentKeys.add(candidateSegmentKey);
      return candidateSegment;
    }

    collisionIndex += 1;
  }
}

function reserveFolderSegment(
  parentFolderSegments: string[],
  folderSegment: string,
  reservedFolderSegmentKeysByParentPath: Map<string, Set<string>>,
): void {
  const parentKey = parentFolderSegments.join("/");
  const reservedSegmentKeys = reservedFolderSegmentKeysByParentPath.get(parentKey) ?? new Set<string>();
  reservedFolderSegmentKeysByParentPath.set(parentKey, reservedSegmentKeys);
  reservedSegmentKeys.add(folderSegment.toLocaleLowerCase("en-US"));
}

function getTreeNodeKey(node: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode): string {
  return isPageTreeNode(node) ? `page:${node.pageId}` : `folder:${node.contentId}`;
}

function isPageTreeNode(
  node: ConfluencePageTreeNode | ConfluenceFolderContentTreeNode,
): node is ConfluencePageTreeNode | Extract<ConfluenceFolderContentTreeNode, ConfluencePageTreePage> {
  return "pageId" in node;
}

async function createAvailableMarkdownPath(
  projectRootPath: string,
  page: ConfluencePageTreePage,
  folderSegments: string[],
  reservedPathKeys: Set<string>,
  pathExists: (path: string) => Promise<boolean>,
  readExistingFile: ((path: string) => Promise<string>) | undefined,
  existingPagePathById?: ReadonlyMap<string, string>,
): Promise<string> {
  const existingPagePath = existingPagePathById?.get(page.pageId);

  if (existingPagePath !== undefined && canUseExistingPagePath(projectRootPath, existingPagePath, reservedPathKeys)) {
    reservedPathKeys.add(createReservedPathKey(existingPagePath));
    return existingPagePath;
  }

  const baseName = removeMarkdownExtension(createSafeMarkdownFileName(page.title, page.pageId));
  const parentFolderPath = joinVaultPath(projectRootPath, ...folderSegments);
  let collisionIndex = 0;

  while (true) {
    const suffix = collisionIndex === 0 ? "" : ` (${collisionIndex})`;
    const candidatePath = joinVaultPath(parentFolderPath, `${baseName}${suffix}${MARKDOWN_FILE_EXTENSION}`);
    const candidatePathKey = createReservedPathKey(candidatePath);

    if (
      !reservedPathKeys.has(candidatePathKey) &&
      await canUseCandidatePath(candidatePath, page.pageId, pathExists, readExistingFile)
    ) {
      reservedPathKeys.add(candidatePathKey);
      return candidatePath;
    }

    collisionIndex += 1;
  }
}

function canUseExistingPagePath(projectRootPath: string, existingPagePath: string, reservedPathKeys: Set<string>): boolean {
  return (
    existingPagePath.endsWith(MARKDOWN_FILE_EXTENSION) &&
    (existingPagePath === projectRootPath || existingPagePath.startsWith(`${projectRootPath}/`)) &&
    !reservedPathKeys.has(createReservedPathKey(existingPagePath))
  );
}

function joinVaultPath(...segments: string[]): string {
  return segments.filter((segment) => segment.length > 0).join("/");
}

function getMarkdownFileBaseNameFromVaultPath(vaultPath: string): string {
  const fileName = vaultPath.split("/").pop() ?? vaultPath;
  return removeMarkdownExtension(fileName);
}

async function canUseCandidatePath(
  candidatePath: string,
  pageId: string,
  pathExists: (path: string) => Promise<boolean>,
  readExistingFile: ((path: string) => Promise<string>) | undefined,
): Promise<boolean> {
  if (!(await pathExists(candidatePath))) {
    return true;
  }

  if (readExistingFile === undefined) {
    return false;
  }

  try {
    return parsePageMarkdownMetadata(await readExistingFile(candidatePath))?.pageId === pageId;
  } catch {
    return false;
  }
}

function createReservedPathKey(vaultPath: string): string {
  return vaultPath.toLocaleLowerCase("en-US");
}

function createFrontmatter(page: ConfluencePageTreePage, markdownBody: string): string {
  return `---
confluencePageId: ${JSON.stringify(page.pageId)}
confluenceTitle: ${JSON.stringify(page.title)}
confluenceVersion: ${page.versionNumber}
confluenceSourceUrl: ${JSON.stringify(page.sourceUrl)}
confluenceParentId: ${page.parentId === null ? "null" : JSON.stringify(page.parentId)}
confluenceContentHash: ${JSON.stringify(calculateMarkdownBodyHash(markdownBody))}
---`;
}

function readQuotedFrontmatterValue(frontmatter: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = frontmatter.match(new RegExp(`^\\s*${escapedKey}:\\s*"([^"]*)"\\s*$`, "mu"));

  return match?.[1] ?? null;
}

function readNumericFrontmatterValue(frontmatter: string, key: string): number | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = frontmatter.match(new RegExp(`^\\s*${escapedKey}:\\s*(\\d+)\\s*$`, "mu"));

  if (match?.[1] === undefined) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function readNestedConfluencePageId(frontmatter: string): string | null {
  const match = frontmatter.match(/^confluence:\s*\n(?:\s+[A-Za-z0-9_-]+:\s*.*\n)*?\s+pageId:\s*"([^"]*)"\s*$/mu);

  return match?.[1] ?? null;
}

function upsertFrontmatterLine(frontmatter: string, key: string, value: string): string {
  const lines = frontmatter.split("\n");
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`, "u");
  const firstExistingIndex = lines.findIndex((line) => keyPattern.test(line));

  if (firstExistingIndex >= 0) {
    const updatedLines = lines.filter((line, index) => index === firstExistingIndex || !keyPattern.test(line));
    updatedLines[firstExistingIndex] = `${key}: ${value}`;
    return updatedLines.join("\n");
  }

  const versionIndex = lines.findIndex((line) => /^\s*confluenceVersion\s*:/u.test(line));
  const insertIndex = key === "confluenceContentHash" && versionIndex >= 0 ? versionIndex + 1 : lines.length;
  lines.splice(insertIndex, 0, `${key}: ${value}`);

  return lines.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createJiraIssueUrl(sourceUrl: string, issueKey: string): string | null {
  try {
    const source = new URL(sourceUrl);
    return new URL(`/browse/${encodeURIComponent(issueKey)}`, source.origin).toString();
  } catch {
    return null;
  }
}

function createSafeFileBaseName(value: string, fallback: string): string {
  const normalizedValue = value
    .replace(UNSAFE_MARKDOWN_FILE_NAME_CHARACTERS, " ")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(TRAILING_DOT_OR_SPACE, "")
    .slice(0, MAX_SAFE_FILE_BASE_NAME_LENGTH)
    .replace(TRAILING_DOT_OR_SPACE, "");

  if (isUsableFileBaseName(normalizedValue)) {
    return normalizedValue;
  }

  return fallback;
}

function createSafePageIdSegment(pageId: string): string {
  const normalizedPageId = pageId.replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");

  if (normalizedPageId.length > 0) {
    return normalizedPageId.slice(0, MAX_SAFE_FILE_BASE_NAME_LENGTH);
  }

  return "unknown";
}

function isUsableFileBaseName(baseName: string): boolean {
  if (baseName.length === 0 || baseName === "." || baseName === "..") {
    return false;
  }

  // Windows 장치 이름은 확장자가 붙어도 파일명으로 사용할 수 없다.
  const windowsDeviceNameCandidate = baseName.split(".")[0]?.toUpperCase() ?? "";
  return !WINDOWS_RESERVED_FILE_NAMES.has(windowsDeviceNameCandidate);
}

function removeMarkdownExtension(fileName: string): string {
  return fileName.endsWith(MARKDOWN_FILE_EXTENSION)
    ? fileName.slice(0, -MARKDOWN_FILE_EXTENSION.length)
    : fileName;
}
