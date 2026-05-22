import { parseHTML } from "linkedom";

export interface UnsupportedConfluenceMacroWarning {
  type: "unsupported-macro";
  name: string;
}

export type ConfluenceStorageToMarkdownWarning = UnsupportedConfluenceMacroWarning;

export interface ConfluenceStorageToMarkdownResult {
  markdown: string;
  warnings: ConfluenceStorageToMarkdownWarning[];
}

export interface ConfluenceStorageToMarkdownOptions {
  resolvePageLinkTarget?: (contentTitle: string) => string;
  resolveJiraIssueUrl?: (issueKey: string) => string | null;
  resolveAttachmentLinkTarget?: (attachmentFileName: string) => string | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

export function convertConfluenceStorageToMarkdown(
  storageValue: string,
  options: ConfluenceStorageToMarkdownOptions = {},
): ConfluenceStorageToMarkdownResult {
  const { document } = parseHTML(`<main>${storageValue}</main>`);
  const root = document.querySelector("main");
  const warnings: ConfluenceStorageToMarkdownWarning[] = [];

  if (!root) {
    return { markdown: "", warnings };
  }

  const markdown = getChildNodes(root)
    .map((node) => renderBlockNode(node, warnings, options))
    .filter((block) => block.length > 0)
    .join("\n\n")
    .trim();

  return { markdown, warnings };
}

function renderBlockNode(
  node: ChildNode,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  if (node.nodeType === TEXT_NODE) {
    return normalizeWhitespace(node.textContent ?? "").trim();
  }

  if (!isElement(node)) {
    return "";
  }

  const tagName = getNormalizedTagName(node);

  if (isHeadingTagName(tagName)) {
    const headingLevel = Number(tagName.slice(1));
    return `${"#".repeat(headingLevel)} ${renderInlineChildren(node, warnings, options).trim()}`.trim();
  }

  if (tagName === "p") {
    return renderInlineChildren(node, warnings, options).trim();
  }

  if (tagName === "ul" || tagName === "ol") {
    return renderList(node, tagName === "ol", warnings, options);
  }

  if (tagName === "table") {
    return renderTable(node, warnings, options);
  }

  if (tagName === "ac:image") {
    return renderConfluenceImage(node);
  }

  if (tagName === "ac:structured-macro") {
    return renderStructuredMacro(node, warnings, options);
  }

  if (tagName === "pre") {
    return renderFencedCodeBlock(getNodeTextContent(node).trim(), "");
  }

  return getChildNodes(node)
    .map((childNode) => renderBlockNode(childNode, warnings, options))
    .filter((block) => block.length > 0)
    .join("\n\n");
}

function renderInlineNode(
  node: ChildNode,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  if (node.nodeType === TEXT_NODE) {
    return normalizeWhitespace(node.textContent ?? "");
  }

  if (node.nodeType === COMMENT_NODE) {
    return extractCommentText(node.nodeValue ?? "") ?? "";
  }

  if (!isElement(node)) {
    return "";
  }

  const tagName = getNormalizedTagName(node);

  if (tagName === "a") {
    const label = renderInlineChildren(node, warnings, options).trim() || (node.getAttribute("href") ?? "").trim();
    const href = (node.getAttribute("href") ?? "").trim();
    return href.length > 0 ? renderMarkdownLink(label, href) : label;
  }

  if (tagName === "ac:link") {
    return renderConfluenceLink(node, warnings, options);
  }

  if (tagName === "ac:structured-macro") {
    return renderStructuredMacro(node, warnings, options);
  }

  if (tagName === "ac:image") {
    return renderConfluenceImage(node);
  }

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "code") {
    return renderInlineCode(getNodeTextContent(node));
  }

  return renderInlineChildren(node, warnings, options);
}

function renderInlineChildren(
  element: Element,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  return getChildNodes(element)
    .map((node) => renderInlineNode(node, warnings, options))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

function renderList(
  listElement: Element,
  isOrdered: boolean,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  let itemNumber = 1;

  return getElementChildren(listElement)
    .filter((childElement) => getNormalizedTagName(childElement) === "li")
    .map((listItem) => {
      const marker = isOrdered ? `${itemNumber++}.` : "-";
      const itemContent = renderListItemContent(listItem, warnings, options);
      return `${marker} ${indentContinuationLines(itemContent)}`.trimEnd();
    })
    .join("\n");
}

function renderListItemContent(
  listItem: Element,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const inlineParts: string[] = [];
  const blockParts: string[] = [];

  for (const childNode of getChildNodes(listItem)) {
    if (isElement(childNode) && ["ul", "ol"].includes(getNormalizedTagName(childNode))) {
      blockParts.push(renderBlockNode(childNode, warnings, options));
      continue;
    }

    if (isElement(childNode) && isBlockTagName(getNormalizedTagName(childNode))) {
      blockParts.push(renderBlockNode(childNode, warnings, options));
      continue;
    }

    inlineParts.push(renderInlineNode(childNode, warnings, options));
  }

  return [inlineParts.join("").trim(), ...blockParts]
    .filter((part) => part.length > 0)
    .join("\n");
}

function renderStructuredMacro(
  macroElement: Element,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const macroName = (macroElement.getAttribute("ac:name") ?? "unknown").trim() || "unknown";

  if (macroName === "jira") {
    return renderJiraMacro(macroElement, options);
  }

  if (macroName === "view-file") {
    return renderViewFileMacro(macroElement, options);
  }

  if (macroName === "code") {
    const language = findMacroParameterValue(macroElement, "language");
    const codeBody = findFirstChildElementByTagName(macroElement, "ac:plain-text-body")
      ?? findFirstChildElementByTagName(macroElement, "ac:rich-text-body");
    const code = codeBody ? getNodeTextContent(codeBody).trim() : "";

    return renderFencedCodeBlock(code, sanitizeCodeFenceInfo(language));
  }

  warnings.push({ type: "unsupported-macro", name: macroName });
  return `> [!warning] Confluence macro not converted: ${macroName}`;
}

function renderJiraMacro(
  macroElement: Element,
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const issueKey = findMacroParameterValue(macroElement, "key");

  if (issueKey.length === 0) {
    return "> [!note] Confluence Jira issue";
  }

  const issueUrl = options.resolveJiraIssueUrl?.(issueKey) ?? null;

  return issueUrl !== null && issueUrl.length > 0
    ? `[${escapeMarkdownLinkLabel(issueKey)}](${issueUrl})`
    : issueKey;
}

function renderViewFileMacro(
  macroElement: Element,
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const attachmentFileName = (
    findFirstDescendantElementByTagName(macroElement, "ri:attachment")?.getAttribute("ri:filename")
    ?? findMacroParameterValue(macroElement, "name")
    ?? ""
  ).trim();

  if (attachmentFileName.length === 0) {
    return "> [!note] Confluence attachment viewer";
  }

  const attachmentLinkTarget = options.resolveAttachmentLinkTarget?.(attachmentFileName)?.trim() ?? "";

  if (attachmentLinkTarget.length > 0) {
    return `[[${escapeObsidianWikiLinkPart(attachmentLinkTarget)}|${escapeObsidianWikiLinkPart(attachmentFileName)}]]`;
  }

  return `> [!note] Confluence attachment viewer: ${attachmentFileName}`;
}

function escapeObsidianWikiLinkPart(value: string): string {
  return value
    .replace(/[[\]\r\n]/g, " ")
    .replace(/\|/g, "¦")
    .replace(/\s+/g, " ")
    .trim();
}

function renderTable(
  tableElement: Element,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const rows = collectTableRows(tableElement);

  if (rows.length === 0) {
    return "";
  }

  const tableCells = rows.map((row) => getElementChildren(row).filter((cell) => isTableCellTagName(getNormalizedTagName(cell))));
  const columnCount = Math.max(...tableCells.map((cells) => cells.length));

  if (columnCount === 0) {
    return "";
  }

  const [headerCells = [], ...bodyRows] = tableCells;
  const header = renderMarkdownTableRow(headerCells, columnCount, warnings, options);
  const separator = renderMarkdownTableSeparator(columnCount);
  const body = bodyRows.map((rowCells) => renderMarkdownTableRow(rowCells, columnCount, warnings, options));

  return [header, separator, ...body].join("\n");
}

function collectTableRows(element: Element): Element[] {
  const rows: Element[] = [];

  for (const childElement of getElementChildren(element)) {
    const tagName = getNormalizedTagName(childElement);

    if (tagName === "tr") {
      rows.push(childElement);
      continue;
    }

    if (["thead", "tbody", "tfoot"].includes(tagName)) {
      rows.push(...collectTableRows(childElement));
    }
  }

  return rows;
}

function renderMarkdownTableRow(
  cells: Element[],
  columnCount: number,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const values = Array.from({ length: columnCount }, (_, index) => {
    const cell = cells[index];
    return cell ? escapeMarkdownTableCell(renderInlineChildren(cell, warnings, options).trim()) : "";
  });

  return `| ${values.join(" | ")} |`;
}

function renderMarkdownTableSeparator(columnCount: number): string {
  return `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function escapeMarkdownLinkLabel(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/[[\]]/g, (character) => `\\${character}`);
}

function escapeMarkdownLinkDestination(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/ /g, "%20")
    .replace(/\)/g, "\\)");
}

function renderMarkdownLink(label: string, destination: string): string {
  return `[${escapeMarkdownLinkLabel(label)}](${escapeMarkdownLinkDestination(destination)})`;
}

function renderMarkdownImage(label: string, destination: string): string {
  return `![${escapeMarkdownLinkLabel(label)}](${escapeMarkdownLinkDestination(destination)})`;
}

function renderFencedCodeBlock(code: string, infoString: string): string {
  const fence = "`".repeat(Math.max(3, getLongestBacktickRunLength(code) + 1));
  return `${fence}${infoString}\n${code}\n${fence}`;
}

function renderInlineCode(code: string): string {
  const delimiter = "`".repeat(Math.max(1, getLongestBacktickRunLength(code) + 1));
  const needsPadding = /^[` ]|[` ]$/.test(code);
  return needsPadding ? `${delimiter} ${code} ${delimiter}` : `${delimiter}${code}${delimiter}`;
}

function sanitizeCodeFenceInfo(value: string): string {
  return value.replace(/[\r\n`]/g, "").trim();
}

function getLongestBacktickRunLength(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function renderConfluenceLink(
  linkElement: Element,
  warnings: ConfluenceStorageToMarkdownWarning[],
  options: ConfluenceStorageToMarkdownOptions,
): string {
  const linkBody = findFirstDescendantElementByTagName(linkElement, "ac:link-body")
    ?? findFirstDescendantElementByTagName(linkElement, "ac:plain-text-link-body");
  const linkedPage = findFirstChildElementByTagName(linkElement, "ri:page");
  const linkedUrl = findFirstChildElementByTagName(linkElement, "ri:url");
  const pageTitle = (linkedPage?.getAttribute("ri:content-title") ?? "").trim();
  const url = (linkedUrl?.getAttribute("ri:value") ?? "").trim();
  const label = (linkBody ? renderInlineChildren(linkBody, warnings, options).trim() : "") || pageTitle || url;

  if (pageTitle.length > 0) {
    const linkTarget = options.resolvePageLinkTarget?.(pageTitle) ?? pageTitle;
    const escapedLinkTarget = escapeObsidianWikiLinkPart(linkTarget);
    const escapedLabel = escapeObsidianWikiLinkPart(label);
    return label === pageTitle ? `[[${escapedLinkTarget}]]` : `[[${escapedLinkTarget}|${escapedLabel}]]`;
  }

  if (url.length > 0) {
    return label.length > 0 ? renderMarkdownLink(label, url) : url;
  }

  return label;
}

function renderConfluenceImage(imageElement: Element): string {
  const imageUrl =
    (imageElement.getAttribute("ac:src") ?? "").trim() ||
    (findFirstDescendantElementByTagName(imageElement, "ri:url")?.getAttribute("ri:value") ?? "").trim();

  if (imageUrl.length === 0) {
    return "";
  }

  return renderMarkdownImage("image", imageUrl);
}

function findMacroParameterValue(macroElement: Element, parameterName: string): string {
  for (const childElement of getElementChildren(macroElement)) {
    if (
      getNormalizedTagName(childElement) === "ac:parameter"
      && childElement.getAttribute("ac:name") === parameterName
    ) {
      return getNodeTextContent(childElement).trim();
    }
  }

  return "";
}

function findFirstChildElementByTagName(element: Element, tagName: string): Element | null {
  for (const childElement of getElementChildren(element)) {
    if (getNormalizedTagName(childElement) === tagName) {
      return childElement;
    }
  }

  return null;
}

function findFirstDescendantElementByTagName(element: Element, tagName: string): Element | null {
  for (const childElement of getElementChildren(element)) {
    if (getNormalizedTagName(childElement) === tagName) {
      return childElement;
    }

    const nestedMatch = findFirstDescendantElementByTagName(childElement, tagName);

    if (nestedMatch !== null) {
      return nestedMatch;
    }
  }

  return null;
}

function getNodeTextContent(node: Node): string {
  if (node.nodeType === COMMENT_NODE) {
    return extractCommentText(node.nodeValue ?? "") ?? "";
  }

  return getChildNodes(node).map(getNodeTextContent).join("") || (node.textContent ?? "");
}

function extractCommentText(value: string): string | null {
  const cdataMatch = value.match(/^\[CDATA\[(.*)\]\]$/s);
  return cdataMatch ? cdataMatch[1] : null;
}

function getChildNodes(node: Node): ChildNode[] {
  return Array.from(node.childNodes);
}

function getElementChildren(element: Element): Element[] {
  return getChildNodes(element).filter(isElement);
}

function getNormalizedTagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function isHeadingTagName(tagName: string): boolean {
  return /^h[1-6]$/.test(tagName);
}

function isBlockTagName(tagName: string): boolean {
  return [
    "ac:structured-macro",
    "blockquote",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ol",
    "p",
    "pre",
    "table",
    "ul",
  ].includes(tagName);
}

function isTableCellTagName(tagName: string): boolean {
  return tagName === "td" || tagName === "th";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function indentContinuationLines(value: string): string {
  return value.replace(/\n/g, "\n  ");
}
