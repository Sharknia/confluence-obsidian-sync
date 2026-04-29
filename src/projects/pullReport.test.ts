import { describe, expect, it } from "vitest";
import { buildPullReportPath, parsePullReportMarkdown } from "./pullReport";

describe("pullReport", () => {
  it("builds latest report path next to the project folder", () => {
    expect(buildPullReportPath("confluence/기획 문서")).toBe("logs/latest.md");
    expect(buildPullReportPath("/confluence/기획 문서/")).toBe("logs/latest.md");
  });

  it("builds latest report path at vault root for a top-level project folder", () => {
    expect(buildPullReportPath("기획 문서")).toBe("logs/latest.md");
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
- [[confluence/기획 문서/Old.md]] -> [[confluence/기획 문서/.confluence-sync/trash/2026/Old.md]]

## 로컬 수정 스킵
- [[confluence/기획 문서/Draft.md]] pageId=200 reason=local-change
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
      conversionFailureCount: 0,
      fetchFailureLines: [],
      conversionIssueLines: [],
      safeDeleteLines: [
        "- [[confluence/기획 문서/Old.md]] -> [[confluence/기획 문서/.confluence-sync/trash/2026/Old.md]]"
      ],
      skippedLocalChangeLines: ["- [[confluence/기획 문서/Draft.md]] pageId=200 reason=local-change"]
    });
  });

  it("parses detailed recent issue lines", () => {
    const summary = parsePullReportMarkdown(`# Pull Report

- 실행 시각: 2026-04-29T10:11:12.000Z
- 추가: 1개
- 갱신: 0개
- 안전 삭제: 0개
- 로컬 수정 스킵: 0개
- 변경 없음: 0개
- 조회 실패: 1개
- 변환 경고: 1개
- 변환 실패: 1개

## 추가
- [[confluence/Root/Root.md]] pageId=100

## 조회 실패 상세
- pageId=200 title="Private Child" reason=permission-denied message="Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."

## 변환 문제 상세
- pageId=100 title="Root" severity=warning message="지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: toc"
- pageId=300 title="Broken" severity=error message="Confluence storage를 Markdown으로 변환할 수 없습니다: parse failed"
`);

    expect(summary).toMatchObject({
      fetchFailureCount: 1,
      conversionWarningCount: 1,
      conversionFailureCount: 1,
      fetchFailureLines: [
        '- pageId=200 title="Private Child" reason=permission-denied message="Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."'
      ],
      conversionIssueLines: [
        '- pageId=100 title="Root" severity=warning message="지원하지 않는 Confluence macro가 Markdown 경고로 변환됐습니다: toc"',
        '- pageId=300 title="Broken" severity=error message="Confluence storage를 Markdown으로 변환할 수 없습니다: parse failed"'
      ]
    });
  });

  it("returns null for non-report markdown", () => {
    expect(parsePullReportMarkdown("# Other")).toBeNull();
  });
});
