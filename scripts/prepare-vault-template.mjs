/* global process */

import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { packageCli } from "./package-cli.mjs";

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

const cliDirectory = join(vaultTemplateRoot, "cli");
await mkdir(cliDirectory, { recursive: true });
await copyFile(await packageCli(projectRoot), join(cliDirectory, "confluence-sync-cli.tgz"));
const version = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")).version;
const templatePath = join(vaultTemplateRoot, "template.json");
const template = JSON.parse(await readFile(templatePath, "utf8"));
await writeFile(templatePath, JSON.stringify({ ...template, pluginVersion: version, cliVersion: version }, null, 2) + "\n");

async function resolveVaultTemplateRoot() {
  const configuredRoot = process.env.VAULT_TEMPLATE_ROOT;
  const candidateRoot =
    configuredRoot === undefined || configuredRoot.trim().length === 0
      ? resolve(projectRoot, "..", "confluence-obsidian-vault-template")
      : resolve(configuredRoot);

  await access(join(candidateRoot, "template.json"));

  return candidateRoot;
}
