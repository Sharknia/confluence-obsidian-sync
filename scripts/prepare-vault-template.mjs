import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDirectory = join(projectRoot, "dist");
const pluginDirectory = join(
  projectRoot,
  "vault-template",
  ".obsidian",
  "plugins",
  "confluence-obsidian-sync"
);

await mkdir(pluginDirectory, { recursive: true });

await Promise.all([
  copyFile(join(distDirectory, "main.js"), join(pluginDirectory, "main.js")),
  copyFile(join(distDirectory, "manifest.json"), join(pluginDirectory, "manifest.json")),
  copyFile(join(distDirectory, "styles.css"), join(pluginDirectory, "styles.css"))
]);
