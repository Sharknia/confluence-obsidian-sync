/* global console, process */

import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const pluginAssetNames = ["main.js", "manifest.json", "styles.css"];

export function buildPluginPackagePlan({ projectRoot, manifest }) {
  const pluginId = getRequiredManifestString(manifest, "id");
  const pluginVersion = getRequiredManifestString(manifest, "version");
  const distDirectory = join(projectRoot, "dist");
  const pluginDirectory = join(distDirectory, pluginId);

  return {
    distDirectory,
    pluginDirectory,
    zipPath: join(distDirectory, `${pluginId}-${pluginVersion}.zip`),
    assets: pluginAssetNames.map((fileName) => ({
      fileName,
      sourcePath: join(distDirectory, fileName),
      targetPath: join(pluginDirectory, fileName)
    }))
  };
}

export async function packagePlugin(projectRoot) {
  const manifest = await readManifest(projectRoot);
  const plan = buildPluginPackagePlan({ projectRoot, manifest });

  await rm(plan.pluginDirectory, { recursive: true, force: true });
  await rm(plan.zipPath, { force: true });
  await mkdir(plan.pluginDirectory, { recursive: true });

  for (const asset of plan.assets) {
    await copyFile(asset.sourcePath, asset.targetPath);
  }

  createZipArchive(plan);

  return plan;
}

async function readManifest(projectRoot) {
  const rawManifest = await readFile(join(projectRoot, "manifest.json"), "utf8");
  return JSON.parse(rawManifest);
}

function getRequiredManifestString(manifest, fieldName) {
  const fieldValue = manifest?.[fieldName];

  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    throw new Error(`manifest.json의 ${fieldName} 값이 필요합니다.`);
  }

  return fieldValue.trim();
}

function createZipArchive(plan) {
  // Obsidian 수동 설치가 쉽도록 zip 내부 최상위에 플러그인 폴더를 둔다.
  const zipResult = spawnSync("zip", ["-qr", basename(plan.zipPath), basename(plan.pluginDirectory)], {
    cwd: plan.distDirectory,
    encoding: "utf8"
  });

  if (zipResult.status !== 0) {
    const errorMessage = zipResult.stderr.trim() || zipResult.stdout.trim() || "zip 생성 중 알 수 없는 오류가 발생했습니다.";
    throw new Error(errorMessage);
  }
}

async function runCli() {
  const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const plan = await packagePlugin(projectRoot);

  console.log(`Created ${plan.zipPath}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
