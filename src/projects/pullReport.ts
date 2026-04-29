export interface PullReportSummary {
  pulledAt: string;
  createCount: number;
  updateCount: number;
  safeDeleteCount: number;
  skippedLocalChangeCount: number;
  unchangedCount: number;
  fetchFailureCount: number;
  conversionWarningCount: number;
  conversionFailureCount: number;
  fetchFailureLines: string[];
  conversionIssueLines: string[];
  safeDeleteLines: string[];
  skippedLocalChangeLines: string[];
}

export function buildPullReportPath(projectRootPath: string): string {
  void projectRootPath;

  return joinVaultPath("logs", "latest.md");
}

export function parsePullReportMarkdown(markdown: string): PullReportSummary | null {
  if (!markdown.startsWith("# Pull Report")) {
    return null;
  }

  const pulledAt = readStringValue(markdown, "실행 시각");

  if (pulledAt === null) {
    return null;
  }

  return {
    pulledAt,
    createCount: readCountValue(markdown, "추가"),
    updateCount: readCountValue(markdown, "갱신"),
    safeDeleteCount: readCountValue(markdown, "안전 삭제"),
    skippedLocalChangeCount: readCountValue(markdown, "로컬 수정 스킵"),
    unchangedCount: readCountValue(markdown, "변경 없음"),
    fetchFailureCount: readCountValue(markdown, "조회 실패"),
    conversionWarningCount: readCountValue(markdown, "변환 경고"),
    conversionFailureCount: readCountValue(markdown, "변환 실패"),
    fetchFailureLines: readSectionLines(markdown, "조회 실패 상세"),
    conversionIssueLines: readSectionLines(markdown, "변환 문제 상세"),
    safeDeleteLines: readSectionLines(markdown, "안전 삭제"),
    skippedLocalChangeLines: readSectionLines(markdown, "로컬 수정 스킵")
  };
}

function readStringValue(markdown: string, label: string): string | null {
  const match = markdown.match(new RegExp(`^- ${escapeRegExp(label)}: (.+)$`, "mu"));

  return match?.[1]?.trim() ?? null;
}

function readCountValue(markdown: string, label: string): number {
  const rawValue = readStringValue(markdown, label);
  const match = rawValue?.match(/^(\d+)개$/u);

  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10);
}

function readSectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const headingLine = `## ${heading}`;
  const headingIndex = lines.findIndex((line) => line.trim() === headingLine);

  if (headingIndex === -1) {
    return [];
  }

  const sectionLines: string[] = [];

  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    sectionLines.push(line);
  }

  return sectionLines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && line !== "- 없음");
}

function joinVaultPath(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ""))
    .filter((segment) => segment.length > 0)
    .join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
