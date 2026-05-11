export const DEFAULT_PLUGIN_RELEASE_REPOSITORY = "Sharknia/confluence-obsidian-sync";
export const DEFAULT_PLUGIN_ID = "confluence-obsidian-sync";
export const REQUIRED_PLUGIN_ASSET_NAMES = ["main.js", "manifest.json", "styles.css"] as const;

export type RequiredPluginAssetName = (typeof REQUIRED_PLUGIN_ASSET_NAMES)[number];

export interface SelectedPluginReleaseAsset {
  name: RequiredPluginAssetName;
  downloadUrl: string;
}

export interface PluginUpdateResult {
  version: string;
  installedAssetNames: RequiredPluginAssetName[];
}

export interface PluginUpdaterFileSystem {
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  copyFile: (fromPath: string, toPath: string) => Promise<void>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
}

export interface UpdatePluginFromLatestReleaseInput {
  repository: string;
  pluginId: string;
  pluginDirectoryPath: string;
  temporaryDirectoryPath: string;
  requestJson: (url: string) => Promise<unknown>;
  requestArrayBuffer: (url: string) => Promise<ArrayBuffer>;
  fileSystem: PluginUpdaterFileSystem;
  joinPath: (...parts: string[]) => string;
}

interface GitHubReleaseAssetLike {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubReleaseLike {
  tag_name?: unknown;
  assets?: unknown;
}

export function buildGitHubLatestReleaseApiUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

export function selectRequiredReleaseAssets(release: unknown): SelectedPluginReleaseAsset[] {
  const releaseLike = parseRelease(release);

  return REQUIRED_PLUGIN_ASSET_NAMES.map((requiredName) => {
    const asset = releaseLike.assets.find((candidate) => candidate.name === requiredName);

    if (asset === undefined || typeof asset.browser_download_url !== "string" || asset.browser_download_url.length === 0) {
      throw new Error(`GitHub Release에 필요한 플러그인 파일이 없습니다: ${requiredName}`);
    }

    return {
      name: requiredName,
      downloadUrl: asset.browser_download_url
    };
  });
}

export function validatePluginManifestContent(content: string, pluginId: string): { version: string } {
  let manifest: unknown;

  try {
    manifest = JSON.parse(content);
  } catch {
    throw new Error("다운로드한 manifest.json을 읽을 수 없습니다.");
  }

  if (!isRecord(manifest) || manifest.id !== pluginId) {
    throw new Error("다운로드한 manifest.json의 플러그인 ID가 일치하지 않습니다.");
  }

  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
    throw new Error("다운로드한 manifest.json의 버전 형식이 올바르지 않습니다.");
  }

  return { version: manifest.version };
}

export async function updatePluginFromLatestRelease(input: UpdatePluginFromLatestReleaseInput): Promise<PluginUpdateResult> {
  const release = await input.requestJson(buildGitHubLatestReleaseApiUrl(input.repository));
  const selectedAssets = selectRequiredReleaseAssets(release);
  const downloadedAssets = new Map<RequiredPluginAssetName, Uint8Array>();

  for (const asset of selectedAssets) {
    const arrayBuffer = await input.requestArrayBuffer(asset.downloadUrl);
    downloadedAssets.set(asset.name, new Uint8Array(arrayBuffer));
  }

  const manifestBytes = downloadedAssets.get("manifest.json");

  if (manifestBytes === undefined) {
    throw new Error("다운로드한 manifest.json을 찾을 수 없습니다.");
  }

  const { version } = validatePluginManifestContent(new TextDecoder().decode(manifestBytes), input.pluginId);

  await input.fileSystem.mkdir(input.temporaryDirectoryPath, { recursive: true });

  for (const asset of selectedAssets) {
    const data = downloadedAssets.get(asset.name);

    if (data === undefined) {
      throw new Error(`다운로드한 플러그인 파일을 찾을 수 없습니다: ${asset.name}`);
    }

    await input.fileSystem.writeFile(input.joinPath(input.temporaryDirectoryPath, asset.name), data);
  }

  await input.fileSystem.mkdir(input.pluginDirectoryPath, { recursive: true });

  for (const asset of selectedAssets) {
    await input.fileSystem.copyFile(
      input.joinPath(input.temporaryDirectoryPath, asset.name),
      input.joinPath(input.pluginDirectoryPath, asset.name)
    );
  }

  await input.fileSystem.rm(input.temporaryDirectoryPath, { recursive: true, force: true });

  return {
    version,
    installedAssetNames: selectedAssets.map((asset) => asset.name)
  };
}

function parseRelease(release: unknown): { assets: GitHubReleaseAssetLike[] } {
  if (!isRecord(release) || !Array.isArray((release as GitHubReleaseLike).assets)) {
    throw new Error("GitHub Release 정보를 읽을 수 없습니다.");
  }

  return {
    assets: (release as { assets: GitHubReleaseAssetLike[] }).assets
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
