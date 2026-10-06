/* global console */
import process from "node:process";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import esbuild from "esbuild";

const { values } = parseArgs({ options: { vault: { type: "string" } } });
if (!values.vault) throw new Error("--vault 경로가 필요합니다.");

// 소스의 실제 transport/API를 메모리에서 묶어 읽기 검증한다. 인증과 응답 본문은 출력하지 않는다.
const bundle = await esbuild.build({
  stdin: { resolveDir: resolve(import.meta.dirname, ".."), loader: "js", contents: `
    import { readFile } from "node:fs/promises";
    import { join } from "node:path";
    import { createNodeRequestTransport } from "./src/confluence/nodeRequestTransport";
    import { fetchConfluenceRootContentTree, fetchConfluencePageTree } from "./src/confluence/pageTree";
    import { fetchConfluencePageHtmlAttachments, downloadConfluenceHtmlAttachment } from "./src/confluence/attachments";
    import { loadConfluenceSyncSettings } from "./src/settings/defaultSettings";
    export async function smoke(vault) {
      const settings = await loadConfluenceSyncSettings(async () => JSON.parse(await readFile(join(vault, ".obsidian/plugins/confluence-obsidian-sync/data.json"), "utf8")));
      const project = settings.currentProject;
      if (!project || !settings.userEmail || !settings.apiToken) throw new Error("settings unavailable");
      const statuses = {};
      const request = createNodeRequestTransport();
      const transport = async (input) => {
        if (input.method && input.method !== "GET") throw new Error("read-only smoke");
        const result = await request(input);
        for (const status of result.redirectStatuses ?? []) statuses[status] = (statuses[status] ?? 0) + 1;
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
        return result;
      };
      const tree = await fetchConfluenceRootContentTree(settings, project.rootContentType, project.rootContentId, transport);
      const pages = tree.ok ? tree.pages : [];
      const parentIds = new Set(pages.map((page) => page.parentId));
      const leaf = pages.find((page) => !parentIds.has(page.pageId));
      const pageTree = leaf ? await fetchConfluencePageTree(settings, leaf.pageId, transport) : null;
      let attachmentCount = 0, attachmentFailures = 0, downloadedCount = 0;
      for (const page of pages) {
        const listed = await fetchConfluencePageHtmlAttachments(settings, page.pageId, page.title, transport);
        attachmentCount += listed.attachments.length;
        attachmentFailures += listed.issues.length;
        for (const attachment of listed.attachments) {
          const downloaded = await downloadConfluenceHtmlAttachment(settings, attachment, transport);
          if (downloaded.ok) downloadedCount += 1; else attachmentFailures += 1;
        }
      }
      return { rootType: project.rootContentType, treeOk: tree.ok, pageCount: pages.length,
        fetchFailures: tree.ok ? tree.errors.length : 1, pageRootOk: pageTree?.ok ?? false,
        pageRootCount: pageTree?.ok ? pageTree.pages.length : 0, attachmentCount, downloadedCount, attachmentFailures,
        httpStatusCounts: statuses };
    }
  ` },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false, logLevel: "silent"
});

try {
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const result = await module.smoke(values.vault);
  console.log(JSON.stringify(result));
  if (!result.treeOk || result.fetchFailures || !result.pageRootOk || result.attachmentFailures) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ status: "error", reason: "readonly-smoke-failed" }));
  process.exitCode = 1;
}
