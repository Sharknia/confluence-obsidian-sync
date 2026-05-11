import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PLUGIN_RELEASE_REPOSITORY,
  buildGitHubLatestReleaseApiUrl,
  selectRequiredReleaseAssets,
  updatePluginFromLatestRelease,
  validatePluginManifestContent
} from "./pluginUpdater";

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe("buildGitHubLatestReleaseApiUrl", () => {
  it("targets the latest GitHub release for the plugin repository", () => {
    expect(buildGitHubLatestReleaseApiUrl(DEFAULT_PLUGIN_RELEASE_REPOSITORY)).toBe(
      "https://api.github.com/repos/Sharknia/confluence-obsidian-sync/releases/latest"
    );
  });
});

describe("selectRequiredReleaseAssets", () => {
  it("selects only installable plugin assets from a GitHub release", () => {
    expect(
      selectRequiredReleaseAssets({
        tag_name: "0.1.1",
        assets: [
          { name: "main.js", browser_download_url: "https://example.com/main.js" },
          { name: "manifest.json", browser_download_url: "https://example.com/manifest.json" },
          { name: "styles.css", browser_download_url: "https://example.com/styles.css" },
          { name: "source.zip", browser_download_url: "https://example.com/source.zip" }
        ]
      })
    ).toEqual([
      { name: "main.js", downloadUrl: "https://example.com/main.js" },
      { name: "manifest.json", downloadUrl: "https://example.com/manifest.json" },
      { name: "styles.css", downloadUrl: "https://example.com/styles.css" }
    ]);
  });

  it("fails before replacing files when a required asset is missing", () => {
    expect(() =>
      selectRequiredReleaseAssets({
        tag_name: "0.1.1",
        assets: [
          { name: "main.js", browser_download_url: "https://example.com/main.js" },
          { name: "manifest.json", browser_download_url: "https://example.com/manifest.json" }
        ]
      })
    ).toThrow("GitHub Release에 필요한 플러그인 파일이 없습니다: styles.css");
  });
});

describe("validatePluginManifestContent", () => {
  it("accepts the expected plugin id and semantic version", () => {
    expect(
      validatePluginManifestContent(
        JSON.stringify({
          id: "confluence-obsidian-sync",
          version: "0.1.1"
        }),
        "confluence-obsidian-sync"
      )
    ).toEqual({ version: "0.1.1" });
  });

  it("rejects a manifest for a different plugin id", () => {
    expect(() =>
      validatePluginManifestContent(
        JSON.stringify({
          id: "other-plugin",
          version: "0.1.1"
        }),
        "confluence-obsidian-sync"
      )
    ).toThrow("다운로드한 manifest.json의 플러그인 ID가 일치하지 않습니다.");
  });
});

describe("updatePluginFromLatestRelease", () => {
  it("downloads release assets to a temporary directory and replaces only plugin bundle files", async () => {
    const operations: string[] = [];
    const requestJson = vi.fn(() =>
      Promise.resolve({
        tag_name: "0.1.1",
        assets: [
          { name: "main.js", browser_download_url: "https://example.com/main.js" },
          { name: "manifest.json", browser_download_url: "https://example.com/manifest.json" },
          { name: "styles.css", browser_download_url: "https://example.com/styles.css" }
        ]
      })
    );
    const requestArrayBuffer = vi.fn((url: string) => {
      if (url.endsWith("manifest.json")) {
        return Promise.resolve(
          toArrayBuffer(
            JSON.stringify({
              id: "confluence-obsidian-sync",
              version: "0.1.1"
            })
          )
        );
      }

      return Promise.resolve(toArrayBuffer(`downloaded from ${url}`));
    });

    const result = await updatePluginFromLatestRelease({
      repository: "Sharknia/confluence-obsidian-sync",
      pluginId: "confluence-obsidian-sync",
      pluginDirectoryPath: "/vault/.obsidian/plugins/confluence-obsidian-sync",
      temporaryDirectoryPath: "/tmp/confluence-obsidian-sync-update",
      requestJson,
      requestArrayBuffer,
      fileSystem: {
        mkdir: vi.fn((path) => {
          operations.push(`mkdir ${path}`);
          return Promise.resolve();
        }),
        writeFile: vi.fn((path) => {
          operations.push(`write ${path}`);
          return Promise.resolve();
        }),
        copyFile: vi.fn((fromPath, toPath) => {
          operations.push(`copy ${fromPath} ${toPath}`);
          return Promise.resolve();
        }),
        rm: vi.fn((path) => {
          operations.push(`rm ${path}`);
          return Promise.resolve();
        })
      },
      joinPath: (...parts) => parts.join("/")
    });

    expect(result).toEqual({
      version: "0.1.1",
      installedAssetNames: ["main.js", "manifest.json", "styles.css"]
    });
    expect(requestJson).toHaveBeenCalledWith("https://api.github.com/repos/Sharknia/confluence-obsidian-sync/releases/latest");
    expect(operations).toEqual([
      "mkdir /tmp/confluence-obsidian-sync-update",
      "write /tmp/confluence-obsidian-sync-update/main.js",
      "write /tmp/confluence-obsidian-sync-update/manifest.json",
      "write /tmp/confluence-obsidian-sync-update/styles.css",
      "mkdir /vault/.obsidian/plugins/confluence-obsidian-sync",
      "copy /tmp/confluence-obsidian-sync-update/main.js /vault/.obsidian/plugins/confluence-obsidian-sync/main.js",
      "copy /tmp/confluence-obsidian-sync-update/manifest.json /vault/.obsidian/plugins/confluence-obsidian-sync/manifest.json",
      "copy /tmp/confluence-obsidian-sync-update/styles.css /vault/.obsidian/plugins/confluence-obsidian-sync/styles.css",
      "rm /tmp/confluence-obsidian-sync-update"
    ]);
    expect(operations.some((operation) => operation.includes("data.json"))).toBe(false);
  });
});
