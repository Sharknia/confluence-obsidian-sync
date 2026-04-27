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

  it("returns the provided fallback folder name when the title is blank", () => {
    expect(createSafeProjectFolderName("///", "confluence-page-123456789")).toBe("confluence-page-123456789");
  });

  it("returns the provided fallback folder name when the title is a current or parent directory marker", () => {
    expect(createSafeProjectFolderName(".", "confluence-page-123456789")).toBe("confluence-page-123456789");
    expect(createSafeProjectFolderName("..", "confluence-folder-987654321")).toBe("confluence-folder-987654321");
  });
});

describe("buildProjectPaths", () => {
  it("builds page root paths under a safe project title folder", () => {
    expect(buildProjectPaths("confluence", "Project Root", "123456789")).toEqual({
      projectRootPath: "confluence/Project Root",
      manifestFolderPath: "confluence/Project Root/.confluence-sync",
      manifestPath: "confluence/Project Root/.confluence-sync/manifest.json"
    });
  });

  it("builds folder root paths under a safe project title folder", () => {
    expect(buildProjectPaths("confluence", "기획문서", "987654321", "folder")).toEqual({
      projectRootPath: "confluence/기획문서",
      manifestFolderPath: "confluence/기획문서/.confluence-sync",
      manifestPath: "confluence/기획문서/.confluence-sync/manifest.json"
    });
  });

  it("adds a numeric suffix to project title folder candidates", () => {
    expect(buildProjectPaths("confluence", "기획문서", "987654321", "folder", 1)).toEqual({
      projectRootPath: "confluence/기획문서 (1)",
      manifestFolderPath: "confluence/기획문서 (1)/.confluence-sync",
      manifestPath: "confluence/기획문서 (1)/.confluence-sync/manifest.json"
    });
  });

  it("normalizes unsafe project titles before adding a suffix", () => {
    expect(buildProjectPaths("confluence", "Team: API / Sync?", "123456789", "page", 2)).toEqual({
      projectRootPath: "confluence/Team API Sync (2)",
      manifestFolderPath: "confluence/Team API Sync (2)/.confluence-sync",
      manifestPath: "confluence/Team API Sync (2)/.confluence-sync/manifest.json"
    });
  });

  it("falls back to content-id based folder names when the title is unusable", () => {
    expect(buildProjectPaths("confluence", "..", "123456789", "page")).toEqual({
      projectRootPath: "confluence/confluence-page-123456789",
      manifestFolderPath: "confluence/confluence-page-123456789/.confluence-sync",
      manifestPath: "confluence/confluence-page-123456789/.confluence-sync/manifest.json"
    });
    expect(buildProjectPaths("confluence", "..", "987654321", "folder")).toEqual({
      projectRootPath: "confluence/confluence-folder-987654321",
      manifestFolderPath: "confluence/confluence-folder-987654321/.confluence-sync",
      manifestPath: "confluence/confluence-folder-987654321/.confluence-sync/manifest.json"
    });
  });
});

describe("buildProjectManifest", () => {
  it("returns a deterministic manifest with updatedAt equal to createdAt", () => {
    const input = {
      projectName: "Project Root",
      confluenceBaseUrl: "https://example.atlassian.net",
      spaceId: "SPACE",
      rootContentType: "page" as const,
      rootContentId: "123456789",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localFolderPath: "confluence/Project Root",
      createdAt: "2026-04-23T12:34:56.000Z"
    };

    expect(buildProjectManifest(input)).toEqual({
      manifestVersion: 1,
      projectName: "Project Root",
      confluenceBaseUrl: "https://example.atlassian.net",
      spaceId: "SPACE",
      rootContentType: "page",
      rootContentId: "123456789",
      rootPageId: "123456789",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/pages/123456789/Project+Root",
      localRootFolder: "confluence/Project Root",
      localFolderPath: "confluence/Project Root",
      lastPulledAt: null,
      createdAt: "2026-04-23T12:34:56.000Z",
      updatedAt: "2026-04-23T12:34:56.000Z"
    });

    expect(buildProjectManifest(input)).toEqual(buildProjectManifest(input));
  });

  it("stores folder root identity and leaves rootPageId blank", () => {
    expect(
      buildProjectManifest({
        projectName: "Team Folder",
        confluenceBaseUrl: "https://example.atlassian.net",
        spaceId: "SPACE",
        rootContentType: "folder",
        rootContentId: "987654321",
        rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/folders/987654321",
        localFolderPath: "confluence/Team Folder",
        createdAt: "2026-04-23T12:34:56.000Z"
      })
    ).toEqual({
      manifestVersion: 1,
      projectName: "Team Folder",
      confluenceBaseUrl: "https://example.atlassian.net",
      spaceId: "SPACE",
      rootContentType: "folder",
      rootContentId: "987654321",
      rootPageId: "",
      rootUrl: "https://example.atlassian.net/wiki/spaces/DEV/folders/987654321",
      localRootFolder: "confluence/Team Folder",
      localFolderPath: "confluence/Team Folder",
      lastPulledAt: null,
      createdAt: "2026-04-23T12:34:56.000Z",
      updatedAt: "2026-04-23T12:34:56.000Z"
    });
  });
});
