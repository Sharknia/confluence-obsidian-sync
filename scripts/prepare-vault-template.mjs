/* global process */

import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDirectory = join(projectRoot, "dist");
const vaultTemplateRoot = await resolveVaultTemplateRoot();
const pluginDirectory = join(vaultTemplateRoot, ".obsidian", "plugins", "confluence-obsidian-sync");

await mkdir(pluginDirectory, { recursive: true });

await Promise.all([
  copyFile(join(distDirectory, "main.js"), join(pluginDirectory, "main.js")),
  copyFile(join(distDirectory, "manifest.json"), join(pluginDirectory, "manifest.json")),
  copyFile(join(distDirectory, "styles.css"), join(pluginDirectory, "styles.css"))
]);

async function resolveVaultTemplateRoot() {
  const configuredRoot = process.env.VAULT_TEMPLATE_ROOT;
  const candidateRoot =
    configuredRoot === undefined || configuredRoot.trim().length === 0
      ? resolve(projectRoot, "..", "confluence-obsidian-vault-template")
      : resolve(configuredRoot);

  await access(join(candidateRoot, "template.json"));

  return candidateRoot;
}
