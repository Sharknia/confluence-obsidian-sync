import { describe, expect, it } from "vitest";
import {
  buildProjectManifest,
  buildProjectPaths,
  createSafeProjectFolderName,
  normalizeVaultFolderPath
} from "./projectManifest";

describe("normalizeVaultFolderPath", () => {
  it("removes leading and trailing slashes and collapses multiple slashes", () => {
    expect(normalizeVaultFolderPath("/confluence/projects/")).toBe("confluence/projects");
  });

  it("returns confluence when the input is blank", () => {
    expect(normalizeVaultFolderPath("   ")).toBe("confluence");
  });

  it("throws when a path segment is ..", () => {
    expect(() => normalizeVaultFolderPath("../outside")).toThrowError(
      "vault 폴더 경로에는 '..'을 사용할 수 없습니다."
    );
  });
});

describe("createSafeProjectFolderName", () => {
  it("replaces unsafe filename characters and normalizes whitespace", () => {
    expect(createSafeProjectFolderName("Team: API / Sync? <Root>*")).toBe("Team API Sync Root");
  });

  it("falls back to a page-id based folder name when the title is blank", () => {
    expect(createSafeProjectFolderName("///", "123456789")).toBe("confluence-page-123456789");
  });

  it("falls back to the page id when the title is a current or parent directory marker", () => {
    expect(createSafeProjectFolderName(".", "123456789")).toBe("confluence-page-123456789");
    expect(createSafeProjectFolderName("..", "123456789")).toBe("confluence-page-123456789");
  });
});

describe("buildProjectPaths", () => {
  it("builds manifest paths under the normalized vault folder and safe project folder", () => {
    expect(buildProjectPaths("confluence", "Project Root", "123456789")).toEqual({
      projectRootPath: "confluence/confluence-page-123456789",
      manifestFolderPath: "confluence/confluence-page-123456789/.confluence-sync",
      manifestPath: "confluence/confluence-page-123456789/.confluence-sync/manifest.json"
    });
  });

  it("keeps projects with the same title in different page ids separate", () => {
    expect(buildProjectPaths("confluence", "Project Root", "123456789").projectRootPath).toBe(
      "confluence/confluence-page-123456789"
    );
    expect(buildProjectPaths("confluence", "Project Root", "987654321").projectRootPath).toBe(
      "confluence/confluence-page-987654321"
    );
  });

  it("keeps the same project path when the title changes", () => {
    expect(buildProjectPaths("confluence", "Old Root Title", "123456789")).toEqual(
      buildProjectPaths("confluence", "New Root Title", "123456789")
    );
  });

  it("falls back to a safe project folder name when the title is a directory marker", () => {
    expect(buildProjectPaths("confluence", "..", "123456789")).toEqual({
      projectRootPath: "confluence/confluence-page-123456789",
      manifestFolderPath: "confluence/confluence-page-123456789/.confluence-sync",
      manifestPath: "confluence/confluence-page-123456789/.confluence-sync/manifest.json"
    });
  });
});

describe("buildProjectManifest", () => {
  it("returns a deterministic manifest with updatedAt equal to createdAt", () => {
    const input = {
      projectName: "Project Root",
      confluenceBaseUrl: "https://example.atlassian.net",
      spaceId: "SPACE",
      rootPageId: "123456789",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localFolderPath: "confluence/confluence-page-123456789",
      createdAt: "2026-04-23T12:34:56.000Z"
    };

    expect(buildProjectManifest(input)).toEqual({
      manifestVersion: 1,
      projectName: "Project Root",
      confluenceBaseUrl: "https://example.atlassian.net",
      spaceId: "SPACE",
      rootPageId: "123456789",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localRootFolder: "confluence/confluence-page-123456789",
      localFolderPath: "confluence/confluence-page-123456789",
      lastPulledAt: null,
      createdAt: "2026-04-23T12:34:56.000Z",
      updatedAt: "2026-04-23T12:34:56.000Z"
    });

    expect(buildProjectManifest(input)).toEqual(buildProjectManifest(input));
  });
});
