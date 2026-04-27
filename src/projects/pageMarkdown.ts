import { createHash } from "crypto";
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
  pathExists: (path: string) => Promise<boolean>;
  readExistingFile?: (path: string) => Promise<string>;
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

function removeFrontmatterBodySeparator(markdownBody: string): string {
  return markdownBody.startsWith("\n") ? markdownBody.slice(1) : markdownBody;
}

export async function buildPageMarkdownFiles(input: BuildPageMarkdownFilesInput): Promise<PageMarkdownFile[]> {
  const files: PageMarkdownFile[] = [];
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
    );
    pathAssignments.set(page.pageId, vaultPath);
    pagesToWrite.push({ page, folderSegments: [] });
  }

  const linkTargetsByTitle = buildLinkTargetsByTitle(
    pagesToWrite.map((placement) => placement.page),
    pathAssignments,
  );

  for (const { page } of pagesToWrite) {
    const vaultPath = pathAssignments.get(page.pageId);

    if (vaultPath === undefined) {
      continue;
    }

    const markdownConversion = convertConfluenceStorageToMarkdown(page.bodyStorageValue, {
      resolvePageLinkTarget: (contentTitle) => linkTargetsByTitle.get(contentTitle) ?? contentTitle,
      resolveJiraIssueUrl: (issueKey) => createJiraIssueUrl(page.sourceUrl, issueKey),
    });
    const markdownBody = `${markdownConversion.markdown}\n`;

    files.push({
      pageId: page.pageId,
      title: page.title,
      vaultPath,
      warnings: markdownConversion.warnings,
      content: `${createFrontmatter(page, markdownBody)}\n\n${markdownBody}`,
    });
  }

  return files;
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
): Promise<string> {
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
