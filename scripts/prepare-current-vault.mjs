import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const pluginId = "confluence-obsidian-sync";
const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDirectory = join(projectRoot, "dist");
const obsidianDirectory = join(projectRoot, ".obsidian");
const pluginDirectory = join(obsidianDirectory, "plugins", pluginId);
const communityPluginsPath = join(obsidianDirectory, "community-plugins.json");

await mkdir(pluginDirectory, { recursive: true });

await Promise.all([
  copyFile(join(distDirectory, "main.js"), join(pluginDirectory, "main.js")),
  copyFile(join(distDirectory, "manifest.json"), join(pluginDirectory, "manifest.json")),
  copyFile(join(distDirectory, "styles.css"), join(pluginDirectory, "styles.css"))
]);

await ensureCommunityPluginEnabled();

async function ensureCommunityPluginEnabled() {
  const enabledPluginIds = await readEnabledPluginIds();

  if (enabledPluginIds.includes(pluginId)) {
    return;
  }

  enabledPluginIds.push(pluginId);
  await writeFile(communityPluginsPath, `${JSON.stringify(enabledPluginIds, null, 2)}\n`, "utf8");
}

async function readEnabledPluginIds() {
  try {
    const rawCommunityPlugins = await readFile(communityPluginsPath, "utf8");
    const parsedCommunityPlugins = JSON.parse(rawCommunityPlugins);

    if (Array.isArray(parsedCommunityPlugins)) {
      return parsedCommunityPlugins.filter((pluginIdCandidate) => typeof pluginIdCandidate === "string");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return [];
}
