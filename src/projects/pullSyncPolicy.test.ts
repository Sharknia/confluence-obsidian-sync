import { describe, expect, it } from "vitest";
import { calculateMarkdownBodyHash, type PageMarkdownFile } from "./pageMarkdown";
import { createPullSyncPlan, type LocalMarkdownFileSnapshot } from "./pullSyncPolicy";

function createRemoteFile(
  overrides: Partial<PageMarkdownFile> & { pageId: string; vaultPath: string; body: string }
): PageMarkdownFile {
  const contentHash = calculateMarkdownBodyHash(overrides.body);

  return {
    pageId: overrides.pageId,
    title: overrides.title ?? overrides.pageId,
    vaultPath: overrides.vaultPath,
    warnings: [],
    content: `---
confluencePageId: "${overrides.pageId}"
confluenceVersion: 2
confluenceContentHash: "${contentHash}"
---

${overrides.body}`,
  };
}

function createLocalFile(path: string, pageId: string, body: string, hashBody = body): LocalMarkdownFileSnapshot {
  return {
    vaultPath: path,
    content: `---
confluencePageId: "${pageId}"
confluenceVersion: 1
confluenceContentHash: "${calculateMarkdownBodyHash(hashBody)}"
---

${body}`,
  };
}

describe("createPullSyncPlan", () => {
  it("writes new remote pages when no local page exists", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote\n" });

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, operation: "create" }]);
    expect(plan.filesToMoveToSafeDelete).toEqual([]);
    expect(plan.skippedLocalChanges).toEqual([]);
    expect(plan.unchangedFileCount).toBe(0);
  });

  it("updates the existing path for an unchanged local page", () => {
    const remoteFile = createRemoteFile({
      pageId: "100",
      vaultPath: "confluence/Root/New Root.md",
      body: "Remote v2\n",
    });
    const localFile = createLocalFile("confluence/Root/Old Root.md", "100", "Remote v1\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, vaultPath: "confluence/Root/Old Root.md", operation: "update" }]);
    expect(plan.unchangedFileCount).toBe(0);
  });

  it("skips an existing page when the local body changed after the last pull", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote v2\n" });
    const localFile = createLocalFile("confluence/Root/Root.md", "100", "Local draft\n", "Remote v1\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([]);
    expect(plan.skippedLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("force overwrites an existing page when the local body changed after the last pull", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote v2\n" });
    const localFile = createLocalFile("confluence/Root/Root.md", "100", "Local draft\n", "Remote v1\n");

    const plan = createPullSyncPlan(
      {
        projectRootPath: "confluence/Root",
        safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
        remoteFiles: [remoteFile],
        localFiles: [localFile],
      },
      { forceOverwriteLocalChanges: true }
    );

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, vaultPath: "confluence/Root/Root.md", operation: "update" }]);
    expect(plan.skippedLocalChanges).toEqual([]);
    expect(plan.overwrittenLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("moves disappeared remote pages to the safe delete folder", () => {
    const localFile = createLocalFile("confluence/Root/Old/Removed.md", "999", "Old body\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [localFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([
      {
        fromPath: "confluence/Root/Old/Removed.md",
        toPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z/Old/Removed.md",
      },
    ]);
  });

  it("moves disappeared legacy files without a content hash to the safe delete folder", () => {
    const localFile: LocalMarkdownFileSnapshot = {
      vaultPath: "confluence/Root/Legacy Removed.md",
      content: `---
confluence:
  pageId: "999"
---

Legacy body
`,
    };

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [localFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([
      {
        fromPath: "confluence/Root/Legacy Removed.md",
        toPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z/Legacy Removed.md",
      },
    ]);
    expect(plan.skippedLocalChanges).toEqual([]);
  });

  it("does not move disappeared pages that have local edits", () => {
    const localFile = createLocalFile("confluence/Root/Removed.md", "999", "Local draft\n", "Old body\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [localFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([]);
    expect(plan.skippedLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Removed.md"]);
  });

  it("updates legacy files without a hash when their markdown body matches the remote body", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Same body\n" });
    const localFile: LocalMarkdownFileSnapshot = {
      vaultPath: "confluence/Root/Root.md",
      content: `---
confluencePageId: "100"
confluenceVersion: 1
---

Same body
`,
    };

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, vaultPath: "confluence/Root/Root.md", operation: "update" }]);
    expect(plan.skippedLocalChanges).toEqual([]);
  });

  it("skips legacy files without a hash when their markdown body differs from the remote body", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote body\n" });
    const localFile: LocalMarkdownFileSnapshot = {
      vaultPath: "confluence/Root/Root.md",
      content: `---
confluencePageId: "100"
confluenceVersion: 1
---

Local legacy body
`,
    };

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [localFile],
    });

    expect(plan.filesToWrite).toEqual([]);
    expect(plan.skippedLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Root.md"]);
  });

  it("skips duplicate local files that point to a page already represented by another file", () => {
    const remoteFile = createRemoteFile({ pageId: "100", vaultPath: "confluence/Root/Root.md", body: "Remote v2\n" });
    const keptLocalFile = createLocalFile("confluence/Root/Root.md", "100", "Remote v1\n");
    const duplicateLocalFile = createLocalFile("confluence/Root/Duplicate Root.md", "100", "Duplicate local draft\n", "Remote v1\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [remoteFile],
      localFiles: [keptLocalFile, duplicateLocalFile],
    });

    expect(plan.filesToWrite).toEqual([{ ...remoteFile, vaultPath: "confluence/Root/Root.md", operation: "update" }]);
    expect(plan.skippedLocalChanges.map((file) => file.vaultPath)).toEqual(["confluence/Root/Duplicate Root.md"]);
    expect(plan.filesToMoveToSafeDelete).toEqual([]);
  });

  it("moves clean duplicate local files when their page disappeared remotely", () => {
    const firstRemovedFile = createLocalFile("confluence/Root/Removed.md", "999", "Old body\n");
    const duplicateRemovedFile = createLocalFile("confluence/Root/Removed Copy.md", "999", "Old copy body\n");

    const plan = createPullSyncPlan({
      projectRootPath: "confluence/Root",
      safeDeleteRootPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z",
      remoteFiles: [],
      localFiles: [firstRemovedFile, duplicateRemovedFile],
    });

    expect(plan.filesToMoveToSafeDelete).toEqual([
      {
        fromPath: "confluence/Root/Removed.md",
        toPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z/Removed.md",
      },
      {
        fromPath: "confluence/Root/Removed Copy.md",
        toPath: "confluence/Root/.confluence-sync/trash/2026-04-27T00-00-00-000Z/Removed Copy.md",
      },
    ]);
    expect(plan.skippedLocalChanges).toEqual([]);
  });
});
