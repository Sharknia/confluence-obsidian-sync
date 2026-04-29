export interface MarkdownToConfluenceStorageSuccess {
  ok: true;
  storageValue: string;
  warnings: string[];
}

export interface MarkdownToConfluenceStorageFailure {
  ok: false;
  message: string;
}

export type MarkdownToConfluenceStorageResult =
  | MarkdownToConfluenceStorageSuccess
  | MarkdownToConfluenceStorageFailure;

interface MarkdownBlock {
  type: "heading" | "paragraph" | "unordered-list" | "ordered-list" | "code" | "table";
  level?: number;
  language?: string;
  lines: string[];
}

const WIKI_LINK_UNSUPPORTED_MESSAGE =
  "Obsidian wiki link는 MVP Push에서 지원하지 않습니다. 일반 Markdown 링크로 바꾼 뒤 다시 시도하세요.";
const EMBEDDED_IMAGE_UNSUPPORTED_MESSAGE =
  "첨부파일과 이미지는 MVP Push에서 업로드하지 않습니다. 이미지 링크를 제거한 뒤 다시 시도하세요.";
const ATTACHMENT_NOTE_UNSUPPORTED_MESSAGE =
  "Confluence attachment viewer 메모가 있어 Push를 중단합니다. 첨부파일 매크로 손실을 막기 위해 제거 후 다시 시도하세요.";
const UNSUPPORTED_MACRO_WARNING_MESSAGE = "변환되지 않은 Confluence macro 경고가 있어 Push를 중단합니다.";
const UNSAFE_LINK_UNSUPPORTED_MESSAGE =
  "안전하지 않은 링크 URL이 있어 Push를 중단합니다. http, https, mailto, 상대 경로 링크만 사용할 수 있습니다.";
const GENERIC_CONVERSION_FAILURE_MESSAGE = "Markdown을 Confluence storage 형식으로 변환할 수 없습니다.";

export function convertMarkdownToConfluenceStorage(markdown: string): MarkdownToConfluenceStorageResult {
  try {
    const unsupportedPatternMessage = findUnsupportedMarkdownPatternMessage(markdown);

    if (unsupportedPatternMessage !== null) {
      return {
        ok: false,
        message: unsupportedPatternMessage,
      };
    }

    const unsafeLinkMessage = findUnsafeLinkMessage(markdown);

    if (unsafeLinkMessage !== null) {
      return {
        ok: false,
        message: unsafeLinkMessage,
      };
    }

    const blocks = parseMarkdownBlocks(markdown);

    return {
      ok: true,
      storageValue: blocks.map(renderBlock).join(""),
      warnings: [],
    };
  } catch {
    return {
      ok: false,
      message: GENERIC_CONVERSION_FAILURE_MESSAGE,
    };
  }
}

function findUnsupportedMarkdownPatternMessage(markdown: string): string | null {
  if (/\[\[[^\]]+\]\]/u.test(markdown)) {
    return WIKI_LINK_UNSUPPORTED_MESSAGE;
  }

  if (/!\[[^\]]*\]\([^)]+\)/u.test(markdown)) {
    return EMBEDDED_IMAGE_UNSUPPORTED_MESSAGE;
  }

  if (/!\[[^\]]*\]\[[^\]]+\]/u.test(markdown)) {
    return EMBEDDED_IMAGE_UNSUPPORTED_MESSAGE;
  }

  if (/\[!note\]\s+Confluence attachment viewer/imu.test(markdown)) {
    return ATTACHMENT_NOTE_UNSUPPORTED_MESSAGE;
  }

  if (/\[!warning\]\s+Confluence macro not converted:/imu.test(markdown)) {
    return UNSUPPORTED_MACRO_WARNING_MESSAGE;
  }

  return null;
}

function findUnsafeLinkMessage(markdown: string): string | null {
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/gu;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(markdown)) !== null) {
    if (!isSafeLinkHref(match[1] ?? "")) {
      return UNSAFE_LINK_UNSUPPORTED_MESSAGE;
    }
  }

  return null;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalizedLines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < normalizedLines.length) {
    const line = normalizedLines[index] ?? "";

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fencedCodeMatch = line.match(/^```([A-Za-z0-9_-]*)\s*$/u);

    if (fencedCodeMatch !== null) {
      const codeLines: string[] = [];
      index += 1;

      while (index < normalizedLines.length && normalizedLines[index] !== "```") {
        codeLines.push(normalizedLines[index] ?? "");
        index += 1;
      }

      if (index < normalizedLines.length) {
        index += 1;
      }

      blocks.push({ type: "code", language: fencedCodeMatch[1] ?? "", lines: codeLines });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/u);

    if (headingMatch !== null) {
      blocks.push({ type: "heading", level: headingMatch[1]?.length ?? 1, lines: [headingMatch[2] ?? ""] });
      index += 1;
      continue;
    }

    if (isTableStart(normalizedLines, index)) {
      const tableLines: string[] = [];

      while (index < normalizedLines.length && normalizedLines[index]?.trim().startsWith("|")) {
        tableLines.push(normalizedLines[index] ?? "");
        index += 1;
      }

      blocks.push({ type: "table", lines: tableLines });
      continue;
    }

    if (/^-\s+/u.test(line)) {
      const listLines: string[] = [];

      while (index < normalizedLines.length && /^-\s+/u.test(normalizedLines[index] ?? "")) {
        listLines.push((normalizedLines[index] ?? "").replace(/^-\s+/u, ""));
        index += 1;
      }

      blocks.push({ type: "unordered-list", lines: listLines });
      continue;
    }

    if (/^\d+\.\s+/u.test(line)) {
      const listLines: string[] = [];

      while (index < normalizedLines.length && /^\d+\.\s+/u.test(normalizedLines[index] ?? "")) {
        listLines.push((normalizedLines[index] ?? "").replace(/^\d+\.\s+/u, ""));
        index += 1;
      }

      blocks.push({ type: "ordered-list", lines: listLines });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < normalizedLines.length && (normalizedLines[index] ?? "").trim().length > 0) {
      paragraphLines.push(normalizedLines[index] ?? "");
      index += 1;
    }

    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";

  return header.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(separator);
}

function renderBlock(block: MarkdownBlock): string {
  if (block.type === "heading") {
    const level = Math.min(Math.max(block.level ?? 1, 1), 6);
    return `<h${level}>${renderInlineMarkdown(block.lines.join(" "))}</h${level}>`;
  }

  if (block.type === "paragraph") {
    return `<p>${renderInlineMarkdown(block.lines.join("\n"))}</p>`;
  }

  if (block.type === "unordered-list") {
    return `<ul>${block.lines.map((line) => `<li>${renderInlineMarkdown(line)}</li>`).join("")}</ul>`;
  }

  if (block.type === "ordered-list") {
    return `<ol>${block.lines.map((line) => `<li>${renderInlineMarkdown(line)}</li>`).join("")}</ol>`;
  }

  if (block.type === "code") {
    const languageParameter =
      block.language !== undefined && block.language.length > 0
        ? `<ac:parameter ac:name="language">${escapeHtml(block.language)}</ac:parameter>`
        : "";

    return `<ac:structured-macro ac:name="code">${languageParameter}<ac:plain-text-body><![CDATA[${escapeCdata(
      block.lines.join("\n"),
    )}]]></ac:plain-text-body></ac:structured-macro>`;
  }

  return renderTable(block.lines);
}

function renderTable(lines: string[]): string {
  const rows = lines.filter((_, index) => index !== 1).map(parseTableRow);
  const renderedRows = rows
    .map((cells, rowIndex) => {
      const tagName = rowIndex === 0 ? "th" : "td";
      return `<tr>${cells.map((cell) => `<${tagName}>${renderInlineMarkdown(cell)}</${tagName}>`).join("")}</tr>`;
    })
    .join("");

  return `<table><tbody>${renderedRows}</tbody></table>`;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInlineMarkdown(markdown: string): string {
  const inlineParts: string[] = [];
  let remainingMarkdown = markdown;
  const tokenPattern = /(`([^`]+)`)|\[([^\]]+)\]\(([^)]+)\)/u;

  while (remainingMarkdown.length > 0) {
    const match = remainingMarkdown.match(tokenPattern);

    if (match === null || match.index === undefined) {
      inlineParts.push(escapeInlineText(remainingMarkdown));
      break;
    }

    inlineParts.push(escapeInlineText(remainingMarkdown.slice(0, match.index)));

    if (match[2] !== undefined) {
      inlineParts.push(`<code>${escapeHtml(match[2])}</code>`);
    } else {
      const rawHref = match[4] ?? "";

      inlineParts.push(`<a href="${escapeHtmlAttributePreservingEntities(rawHref)}">${escapeHtml(match[3] ?? "")}</a>`);
    }

    remainingMarkdown = remainingMarkdown.slice(match.index + match[0].length);
  }

  return inlineParts.join("");
}

function escapeInlineText(value: string): string {
  return escapeHtml(value).replace(/\n/gu, "<br />");
}

function isSafeLinkHref(href: string): boolean {
  const trimmedHref = href.trim();

  if (trimmedHref.length === 0) {
    return false;
  }

  if (trimmedHref.startsWith("#") || trimmedHref.startsWith("/") || trimmedHref.startsWith("./") || trimmedHref.startsWith("../")) {
    return true;
  }

  try {
    const parsedUrl = new URL(trimmedHref);
    return ["http:", "https:", "mailto:"].includes(parsedUrl.protocol);
  } catch {
    return !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmedHref);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function escapeHtmlAttributePreservingEntities(value: string): string {
  return escapeHtml(value).replace(/&amp;([A-Za-z][A-Za-z0-9]+|#[0-9]+|#x[0-9A-Fa-f]+);/gu, "&$1;").replace(/'/gu, "&#39;");
}

function escapeCdata(value: string): string {
  return value.replace(/\]\]>/gu, "]]]]><![CDATA[>");
}
