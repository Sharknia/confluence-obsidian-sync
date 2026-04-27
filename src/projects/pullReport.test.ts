import { describe, expect, it } from "vitest";
import { buildPullReportPath, parsePullReportMarkdown } from "./pullReport";

describe("pullReport", () => {
  it("builds latest report path next to the project folder", () => {
    expect(buildPullReportPath("confluence/기획 문서")).toBe("confluence/Pull Reports/latest.md");
    expect(buildPullReportPath("/confluence/기획 문서/")).toBe("confluence/Pull Reports/latest.md");
  });

  it("builds latest report path at vault root for a top-level project folder", () => {
    expect(buildPullReportPath("기획 문서")).toBe("Pull Reports/latest.md");
  });

  it("parses latest Pull report summary and issue lines", () => {
    const summary = parsePullReportMarkdown(`# Pull Report

- 실행 시각: 2026-04-27T07:31:08.187Z
- 추가: 0개
- 갱신: 1개
- 안전 삭제: 2개
- 로컬 수정 스킵: 3개
- 변경 없음: 70개
- 조회 실패: 4개
- 변환 경고: 5개

## 추가
- 없음

## 갱신
- \`confluence/기획 문서/A.md\` pageId=100

## 안전 삭제
- \`confluence/기획 문서/Old.md\` -> \`confluence/기획 문서/.confluence-sync/trash/2026/Old.md\`

## 로컬 수정 스킵
- \`confluence/기획 문서/Draft.md\` pageId=200 reason=local-change
`);

    expect(summary).toEqual({
      pulledAt: "2026-04-27T07:31:08.187Z",
      createCount: 0,
      updateCount: 1,
      safeDeleteCount: 2,
      skippedLocalChangeCount: 3,
      unchangedCount: 70,
      fetchFailureCount: 4,
      conversionWarningCount: 5,
      safeDeleteLines: [
        "- `confluence/기획 문서/Old.md` -> `confluence/기획 문서/.confluence-sync/trash/2026/Old.md`"
      ],
      skippedLocalChangeLines: ["- `confluence/기획 문서/Draft.md` pageId=200 reason=local-change"]
    });
  });

  it("returns null for non-report markdown", () => {
    expect(parsePullReportMarkdown("# Other")).toBeNull();
  });
});
