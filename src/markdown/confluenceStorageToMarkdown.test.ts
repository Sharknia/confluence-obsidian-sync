import { describe, expect, it } from "vitest";

import { convertConfluenceStorageToMarkdown } from "./confluenceStorageToMarkdown";

describe("convertConfluenceStorageToMarkdown", () => {
  it("converts common Confluence storage blocks to Markdown", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <h1>Project Plan</h1>
      <p>Read the <a href="https://example.com/spec">spec</a>.</p>
      <ul>
        <li>First item</li>
        <li>Second item</li>
      </ul>
      <ol>
        <li>Step one</li>
        <li>Step two</li>
      </ol>
    `);

    expect(result).toEqual({
      markdown: [
        "# Project Plan",
        "",
        "Read the [spec](https://example.com/spec).",
        "",
        "- First item",
        "- Second item",
        "",
        "1. Step one",
        "2. Step two",
      ].join("\n"),
      warnings: [],
    });
  });

  it("converts sampled Confluence page links to Obsidian wikilinks", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <p>
        참고:
        <ac:link ac:local-id="10bd6237cc2b" ac:card-appearance="inline">
          <ri:page ri:content-title="Multi-Org 구조 및 관련 정책" ri:version-at-save="13" />
          <ac:link-body>Multi-Org 구조 및 관련 정책</ac:link-body>
        </ac:link>
      </p>
    `);

    expect(result).toEqual({
      markdown: "참고: [[Multi-Org 구조 및 관련 정책]]",
      warnings: [],
    });
  });

  it("uses a page link target resolver when converting Confluence page links", () => {
    const result = convertConfluenceStorageToMarkdown(
      `
        <p>
          <ac:link>
            <ri:page ri:content-title="Team: API / Sync?" />
            <ac:link-body>API Sync</ac:link-body>
          </ac:link>
        </p>
      `,
      {
        resolvePageLinkTarget: (contentTitle) => (contentTitle === "Team: API / Sync?" ? "Team API Sync" : contentTitle),
      },
    );

    expect(result).toEqual({
      markdown: "[[Team API Sync|API Sync]]",
      warnings: [],
    });
  });

  it("converts Confluence URL links to Markdown links", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <p>
        <ac:link>
          <ri:url ri:value="https://example.com/spec" />
          <ac:link-body>Spec</ac:link-body>
        </ac:link>
      </p>
    `);

    expect(result).toEqual({
      markdown: "[Spec](https://example.com/spec)",
      warnings: [],
    });
  });

  it("converts Confluence plain text link bodies to Markdown links", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <p>
        <ac:link>
          <ri:url ri:value="https://example.com/plain" />
          <ac:plain-text-link-body><![CDATA[Plain Spec]]></ac:plain-text-link-body>
        </ac:link>
      </p>
    `);

    expect(result).toEqual({
      markdown: "[Plain Spec](https://example.com/plain)",
      warnings: [],
    });
  });

  it("converts sampled Confluence URL images to Markdown images", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <ac:image ac:align="center" ac:layout="center" ac:original-height="310" ac:original-width="915" ac:width="756" ac:src="https://example.com/image.png">
        <ri:url ri:value="https://example.com/image.png" />
      </ac:image>
    `);

    expect(result).toEqual({
      markdown: "![image](https://example.com/image.png)",
      warnings: [],
    });
  });

  it("converts inline Confluence images inside paragraphs", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <p>Before <ac:image ac:src="https://example.com/inline.png"><ri:url ri:value="https://example.com/inline.png" /></ac:image> After</p>
    `);

    expect(result).toEqual({
      markdown: "Before ![image](https://example.com/inline.png) After",
      warnings: [],
    });
  });

  it("converts Confluence code macros to fenced code blocks", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">typescript</ac:parameter>
        <ac:plain-text-body><![CDATA[const answer = 42;
console.log(answer);]]></ac:plain-text-body>
      </ac:structured-macro>
    `);

    expect(result).toEqual({
      markdown: "```typescript\nconst answer = 42;\nconsole.log(answer);\n```",
      warnings: [],
    });
  });

  it("converts Jira macros to issue links when a resolver is provided", () => {
    const result = convertConfluenceStorageToMarkdown(
      `
        <p>
          관련 이슈:
          <ac:structured-macro ac:name="jira">
            <ac:parameter ac:name="key">IS-1251</ac:parameter>
            <ac:parameter ac:name="server">System Jira</ac:parameter>
          </ac:structured-macro>
        </p>
      `,
      {
        resolveJiraIssueUrl: (issueKey) => `https://selta.atlassian.net/browse/${issueKey}`,
      },
    );

    expect(result).toEqual({
      markdown: "관련 이슈: [IS-1251](https://selta.atlassian.net/browse/IS-1251)",
      warnings: [],
    });
  });

  it("converts Confluence view-file macros to visible attachment viewer notes", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <ac:structured-macro ac:name="view-file">
        <ac:parameter ac:name="name">
          <ri:attachment ri:filename="nav-prototype_6.html" ri:version-at-save="2" />
        </ac:parameter>
      </ac:structured-macro>
    `);

    expect(result).toEqual({
      markdown: "> [!note] Confluence attachment viewer: nav-prototype_6.html",
      warnings: [],
    });
  });

  it("converts basic tables and escapes pipes inside cells", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <table>
        <tbody>
          <tr><th>Name</th><th>Value</th></tr>
          <tr><td>Alpha | Beta</td><td>Ready</td></tr>
        </tbody>
      </table>
    `);

    expect(result).toEqual({
      markdown: ["| Name | Value |", "| --- | --- |", "| Alpha \\| Beta | Ready |"].join("\n"),
      warnings: [],
    });
  });

  it("keeps unsupported macros visible and returns warnings", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <ac:structured-macro ac:name="status">
        <ac:parameter ac:name="title">Done</ac:parameter>
      </ac:structured-macro>
    `);

    expect(result).toEqual({
      markdown: "> [!warning] Confluence macro not converted: status",
      warnings: [{ type: "unsupported-macro", name: "status" }],
    });
  });

  it("keeps unsupported inline macros visible and returns warnings", () => {
    const result = convertConfluenceStorageToMarkdown(`
      <p>상태 <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">Done</ac:parameter></ac:structured-macro></p>
    `);

    expect(result).toEqual({
      markdown: "상태 > [!warning] Confluence macro not converted: status",
      warnings: [{ type: "unsupported-macro", name: "status" }],
    });
  });

  it("ignores regular HTML comments while preserving CDATA code bodies", () => {
    const paragraphResult = convertConfluenceStorageToMarkdown("<p>a<!--hidden-->b</p>");
    const codeResult = convertConfluenceStorageToMarkdown(`
      <ac:structured-macro ac:name="code">
        <ac:plain-text-body><![CDATA[const value = "<keep>";]]></ac:plain-text-body>
      </ac:structured-macro>
    `);

    expect(paragraphResult.markdown).toBe("ab");
    expect(codeResult.markdown).toBe("```\nconst value = \"<keep>\";\n```");
  });
});
