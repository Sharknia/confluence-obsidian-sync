import { describe, expect, it } from "vitest";
import { convertMarkdownToConfluenceStorage } from "./markdownToConfluenceStorage";

describe("convertMarkdownToConfluenceStorage", () => {
  it("converts headings, paragraphs, and inline markup safely", () => {
    expect(
      convertMarkdownToConfluenceStorage("# Title\n\nHello `code` and [link](https://example.com?a=1&b=2)\n"),
    ).toEqual({
      ok: true,
      storageValue:
        '<h1>Title</h1><p>Hello <code>code</code> and <a href="https://example.com?a=1&amp;b=2">link</a></p>',
      warnings: [],
    });
  });

  it("does not double escape already escaped link href values", () => {
    expect(convertMarkdownToConfluenceStorage("[link](https://example.com?a=1&amp;b=2)\n")).toEqual({
      ok: true,
      storageValue: '<p><a href="https://example.com?a=1&amp;b=2">link</a></p>',
      warnings: [],
    });
  });

  it("escapes raw HTML instead of passing it through", () => {
    expect(convertMarkdownToConfluenceStorage("Hello <script>alert(1)</script>\n")).toEqual({
      ok: true,
      storageValue: "<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>",
      warnings: [],
    });
  });

  it("preserves soft line breaks inside paragraphs", () => {
    expect(convertMarkdownToConfluenceStorage("첫 줄\n둘째 줄\n")).toEqual({
      ok: true,
      storageValue: "<p>첫 줄<br />둘째 줄</p>",
      warnings: [],
    });
  });

  it("converts unordered and ordered lists", () => {
    expect(convertMarkdownToConfluenceStorage("- One\n- Two\n\n1. First\n2. Second\n")).toEqual({
      ok: true,
      storageValue: "<ul><li>One</li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>",
      warnings: [],
    });
  });

  it("converts fenced code blocks with a Confluence code macro", () => {
    expect(convertMarkdownToConfluenceStorage("```ts\nconst value = 1 < 2;\n```\n")).toEqual({
      ok: true,
      storageValue:
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const value = 1 < 2;]]></ac:plain-text-body></ac:structured-macro>',
      warnings: [],
    });
  });

  it("converts simple markdown tables", () => {
    expect(convertMarkdownToConfluenceStorage("| A | B |\n| --- | --- |\n| 1 | 2 |\n")).toEqual({
      ok: true,
      storageValue:
        "<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>",
      warnings: [],
    });
  });

  it("blocks Obsidian wiki links because Confluence page resolution is not implemented in MVP Push", () => {
    expect(convertMarkdownToConfluenceStorage("[[Target Page|Label]]\n")).toEqual({
      ok: false,
      message: "Obsidian wiki link는 MVP Push에서 지원하지 않습니다. 일반 Markdown 링크로 바꾼 뒤 다시 시도하세요.",
    });
  });

  it("blocks Pull-generated local HTML attachment wiki links during Push", () => {
    expect(
      convertMarkdownToConfluenceStorage("[[confluence/Root/Root.assets/prototype.html|prototype.html]]\n"),
    ).toEqual({
      ok: false,
      message: "Obsidian wiki link는 MVP Push에서 지원하지 않습니다. 일반 Markdown 링크로 바꾼 뒤 다시 시도하세요.",
    });
  });

  it("blocks embedded images because attachment round-trip is outside MVP Push", () => {
    expect(convertMarkdownToConfluenceStorage("![Diagram](diagram.png)\n")).toEqual({
      ok: false,
      message: "첨부파일과 이미지는 MVP Push에서 업로드하지 않습니다. 이미지 링크를 제거한 뒤 다시 시도하세요.",
    });
  });

  it("blocks reference-style embedded images because attachment round-trip is outside MVP Push", () => {
    expect(convertMarkdownToConfluenceStorage("![Diagram][diagram-ref]\n\n[diagram-ref]: diagram.png\n")).toEqual({
      ok: false,
      message: "첨부파일과 이미지는 MVP Push에서 업로드하지 않습니다. 이미지 링크를 제거한 뒤 다시 시도하세요.",
    });
  });

  it("blocks Pull-generated attachment viewer notes to prevent macro loss", () => {
    expect(convertMarkdownToConfluenceStorage("> [!note] Confluence attachment viewer: report.pdf\n")).toEqual({
      ok: false,
      message:
        "Confluence attachment viewer 메모가 있어 Push를 중단합니다. 첨부파일 매크로 손실을 막기 위해 제거 후 다시 시도하세요.",
    });
  });

  it("blocks Pull-generated unsupported macro warnings to prevent silent data loss", () => {
    expect(convertMarkdownToConfluenceStorage("> [!warning] Confluence macro not converted: status\n")).toEqual({
      ok: false,
      message: "변환되지 않은 Confluence macro 경고가 있어 Push를 중단합니다.",
    });
  });

  it("blocks inline Pull-generated unsupported macro warnings", () => {
    expect(convertMarkdownToConfluenceStorage("상태 > [!warning] Confluence macro not converted: status\n")).toEqual({
      ok: false,
      message: "변환되지 않은 Confluence macro 경고가 있어 Push를 중단합니다.",
    });
  });

  it("blocks unsafe markdown link schemes", () => {
    expect(convertMarkdownToConfluenceStorage("[bad](javascript:alert(1))\n")).toEqual({
      ok: false,
      message:
        "안전하지 않은 링크 URL이 있어 Push를 중단합니다. http, https, mailto, 상대 경로 링크만 사용할 수 있습니다.",
    });
  });

  it("allows relative markdown links", () => {
    expect(convertMarkdownToConfluenceStorage("[relative](../Child Page)\n")).toEqual({
      ok: true,
      storageValue: '<p><a href="../Child Page">relative</a></p>',
      warnings: [],
    });
  });
});
