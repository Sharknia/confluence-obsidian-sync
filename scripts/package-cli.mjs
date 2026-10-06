/* global process, console */
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

export async function packageCli(projectRoot) {
  const source = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const dist = join(projectRoot, "dist");
  const staging = join(dist, "cli-package");
  const archive = join(dist, "confluence-sync-cli.tgz");
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("pnpm run package:cli 또는 pnpm run prepare:vault로 실행하세요.");

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await Promise.all(["cli.mjs", "LICENSE", "README.md"].map((name) =>
    copyFile(join(name === "cli.mjs" ? dist : projectRoot, name), join(staging, name))));
  await writeFile(join(staging, "package.json"), JSON.stringify({
    name: "confluence-obsidian-sync-cli", version: source.version, private: true, type: "module",
    bin: { "confluence-sync": "cli.mjs" }, engines: { node: ">=22" }, license: "MIT",
    files: ["cli.mjs", "README.md", "LICENSE", "THIRD-PARTY-NOTICES.txt"]
  }, null, 2) + "\n");
  await writeFile(join(staging, "THIRD-PARTY-NOTICES.txt"), await dependencyNotices(projectRoot, dist));
  const result = spawnSync(process.execPath, [pnpm, "pack", "--out", archive], { cwd: staging, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "CLI 패키지를 생성하지 못했습니다.");
  return archive;
}

async function dependencyNotices(projectRoot, dist) {
  const metadata = JSON.parse(await readFile(join(dist, "cli-metafile.json"), "utf8"));
  const packages = new Map();
  for (const input of Object.keys(metadata.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let directory = dirname(resolve(projectRoot, input));
    while (directory !== projectRoot && directory !== dirname(directory)) {
      let info;
      try { info = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (info?.name && info?.version) { packages.set(`${info.name}@${info.version}`, { directory, info }); break; }
      directory = dirname(directory);
    }
  }
  const notices = [];
  for (const [name, { directory, info }] of [...packages].sort(([left], [right]) => left.localeCompare(right))) {
    const licenses = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying)(\.|$)/iu.test(name));
    const texts = licenses.length
      ? await Promise.all(licenses.sort().map((file) => readFile(join(directory, file), "utf8")))
      : [await readFile(join(projectRoot, "scripts", "licenses", `${name.replace("@", "-")}.txt`), "utf8")];
    notices.push(`${name} (${info.license ?? "라이선스 원문 참고"})\n${texts.join("\n")}`);
  }
  if (!notices.length) throw new Error("번들 의존성의 라이선스 고지를 찾지 못했습니다.");
  return notices.join("\n\n========================================\n\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Created ${await packageCli(dirname(fileURLToPath(new URL("../package.json", import.meta.url))))}`);
}
