import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, chmod, copyFile, rename, readdir } from "node:fs/promises";
import { join, resolve, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { packageCli } from "../../scripts/package-cli.mjs";
import packageInfo from "../../package.json";
import { createNodeVaultStorage } from "../platform/nodeVaultStorage";
import { withVaultOperationLock } from "../platform/vaultOperationLock";
import { createNodeRequestTransport } from "../confluence/nodeRequestTransport";
import { writeMarkdownPages } from "../projects/projectStorage";
import type { CommandResult } from "../commands/commandResult";
import type { CurrentConfluenceProjectSettings } from "../settings/defaultSettings";
import { runPushCurrentPageCommand } from "../commands/pushCurrentPageCommand";
import { createPageMarkdownContent } from "../projects/pageMarkdown";

const execute = promisify(execFile);
const cwd = resolve(import.meta.dirname, "../..");

const windows = process.platform === "win32";
const npmCli = windows ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
  : resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
let installRoot: string;
let installedCommand: string;
let installEnvironment: NodeJS.ProcessEnv;

async function npm(args: string[], environment = installEnvironment) {
  return execute(process.execPath, [npmCli, ...args], { cwd: installRoot, env: environment });
}
async function globalCommand(args: string[], environment = installEnvironment) {
  return windows
    ? execute("cmd.exe", ["/d", "/s", "/c", `""${installedCommand}" ${args.map((value) => `"${value}"`).join(" ")}"`], { cwd: installRoot, env: environment, windowsVerbatimArguments: true })
    : execute(installedCommand, args, { cwd: installRoot, env: environment });
}

beforeAll(async () => {
  installRoot = await mkdtemp(join(tmpdir(), "confluence 설치 "));
  const prefix = join(installRoot, "사용자 prefix");
  const bin = windows ? prefix : join(prefix, "bin");
  installEnvironment = { ...process.env, npm_config_prefix: prefix, npm_config_cache: join(installRoot, "cache"),
    npm_config_userconfig: join(installRoot, "user.npmrc"), npm_config_globalconfig: join(installRoot, "global.npmrc"),
    npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_registry: "http://127.0.0.1:9",
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
  await Promise.all([writeFile(installEnvironment.npm_config_userconfig!, ""), writeFile(installEnvironment.npm_config_globalconfig!, "")]);
  await execute(process.execPath, ["esbuild.cli.config.mjs"], { cwd });
  const archive = await packageCli(cwd);
  const download = join(installRoot, "받은 vault/cli");
  await mkdir(download, { recursive: true });
  await copyFile(archive, join(download, "confluence-sync-cli.tgz"));
  await npm(["install", "--global", "--engine-strict", "./받은 vault/cli/confluence-sync-cli.tgz"]);
  // 원본 배포물을 이동해도 npm이 설치한 복사본은 독립적으로 실행되어야 한다.
  await rename(join(installRoot, "받은 vault"), join(installRoot, "이동한 vault"));
  installedCommand = join(bin, windows ? "confluence-sync.cmd" : "confluence-sync");
}, 30000);

afterAll(async () => { if (installRoot) await rm(installRoot, { recursive: true, force: true }); });

async function scenario(action: (context: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
  const current = await fixture();
  try { await action(current); }
  finally { await current.close(); }
}

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), "confluence-cli-"));
  const state = { version: 1, body: "<p>Original</p>", putCount: 0, requestCount: 0,
    failChild: false, attachment: false, folder: false, pagination: false, paginationRequests: 0,
    mode: "normal" as "normal" | "lost" | "unreadable" };
  const server = createServer((request, response) => {
    state.requestCount += 1;
    const url = new URL(request.url ?? "/", "http://localhost");
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value));
    };
    if (request.method === "PUT") {
      state.putCount += 1;
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      request.on("end", () => {
        const update = JSON.parse(body) as { version: { number: number }; body: { value: string } };
        if (update.version.number !== state.version + 1) { json({}, 409); return; }
        state.version = update.version.number; state.body = update.body.value;
        if (state.mode === "lost") { request.socket.destroy(); return; }
        if (state.mode === "unreadable") { response.writeHead(200, { "content-type": "application/json" }); response.end("bad json"); return; }
        json({ id: "100", title: "Root", version: { number: state.version } });
      });
      return;
    }
    if (url.pathname.endsWith("/user/current")) { json({ accountId: "account", displayName: "test@example.com" }); return; }
    if (url.pathname.endsWith("/attachments")) {
      json({ results: state.attachment && url.pathname.includes("/100/") ? [{ id: "att", status: "current", title: "prototype.html", pageId: "100",
        mediaType: "text/html", fileSize: 10, downloadLink: "/wiki/download/attachments/100/prototype.html", version: { number: 1 } }] : [] }); return;
    }
    if (url.pathname.endsWith("/download")) { response.writeHead(200, { "content-type": "text/html" }); response.end("<html><body>Prototype</body></html>"); return; }
    if (url.pathname.includes("/folders/300") && !url.pathname.endsWith("/descendants")) { json({ id: "300", title: "Folder", spaceId: "S" }); return; }
    if (url.pathname.endsWith("/descendants")) {
      if (state.pagination && url.pathname.includes("/100/")) {
        state.paginationRequests += 1;
        json(url.searchParams.has("cursor") ? { results: [] } : {
          results: [{ id: "200", title: "Child", parentId: "100", depth: 1, childPosition: 0, type: "page" }],
          _links: { next: "/wiki/api/v2/pages/100/descendants?cursor=next" }
        }); return;
      }
      json({ results: url.pathname.includes("/300/") ? [{ id: "100", title: "Root", parentId: "300", depth: 1, childPosition: 0, type: "page" }]
        : url.pathname.includes("/100/") ? [{ id: "200", title: "Child", parentId: "100", depth: 1, childPosition: 0, type: "page" }] : [] }); return;
    }
    if (url.pathname.includes("/pages/200") && state.failChild) { json({}, 503); return; }
    const id = url.pathname.split("/").at(-1);
    if (id === "100" && state.mode === "unreadable" && state.putCount) { json({}, 503); return; }
    json({ id, title: id === "100" ? "Root" : "Child", spaceId: "S", parentId: id === "200" ? "100" : state.folder ? "300" : null,
      version: { number: state.version }, body: { storage: { value: state.body } } });
  });
  await new Promise<void>((resolveListen) => { server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server address unavailable");
  const base = `http://127.0.0.1:${address.port}`;
  const environment = { ...installEnvironment, CONFLUENCE_BASE_URL: base, CONFLUENCE_USER_EMAIL: "test@example.com", CONFLUENCE_API_TOKEN: "cli-test-token" };
  async function run(args: string[], pnpm = false) {
    let stdout = "", stderr = "", code = 0;
    try {
      const result = pnpm
        ? await execute(process.execPath, [process.env.npm_execpath!, "--silent", "run", "cli", ...args, "--vault", vault], { cwd, env: environment })
        : await globalCommand([...args, "--vault", vault], environment);
      stdout = result.stdout; stderr = result.stderr;
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      if (typeof failure.code !== "number") throw error;
      code = failure.code; stdout = failure.stdout; stderr = failure.stderr;
    }
    expect(stderr).toBe("");
    expect(stdout).not.toContain(environment.CONFLUENCE_API_TOKEN);
    expect(stdout).not.toContain(environment.CONFLUENCE_USER_EMAIL);
    return { code, result: JSON.parse(stdout) as CommandResult & { project?: CurrentConfluenceProjectSettings; reportScope?: string } };
  }
  async function init(folder = false) {
    state.folder = folder;
    const result = await run(["init", "--root", folder ? `${base}/wiki/spaces/S/folder/300` : `${base}/wiki/spaces/S/pages/100`]);
    expect(result.code).toBe(0);
    const project = result.result.project?.localFolderPath;
    if (!project) throw new Error("project was not returned");
    return project;
  }
  return { vault, state, base, run, init, close: async () => {
    await new Promise<void>((resolveClose, reject) => { server.close((error) => error ? reject(error) : resolveClose()); });
    await rm(vault, { recursive: true, force: true });
  } };
}

describe("standalone CLI", () => {
  it("runs both documented entrypoints and the complete pull/edit/push/backup flow without Obsidian", async () => {
    await scenario(async ({ vault, run, init, state }) => {
      expect((await run(["check"], true)).code).toBe(0);
      const project = await init();
      state.pagination = true;
      expect((await run(["pull-tree", "--project", project])).code).toBe(0);
      expect(state.paginationRequests).toBe(2);
      const file = `${project}/Root.md`;
      const original = await readFile(join(vault, file), "utf8");
      await writeFile(join(vault, file), `${original}\nDraft\n`);
      expect((await run(["push-page", "--project", project, "--file", file])).result.reason).toBe("confirmation-required");
      expect(state.putCount).toBe(0);
      expect((await run(["push-page", "--project", project, "--file", file, "--yes"])).result.remoteState).toBe("applied");
      expect(state.putCount).toBe(1);
      expect((await readFile(join(vault, file), "utf8"))).toContain("confluenceVersion: 2");
      const current = await readFile(join(vault, file), "utf8");
      await writeFile(join(vault, file), `${current}\nLocal edits\n`);
      expect((await run(["pull-page", "--project", project, "--file", file])).code).toBe(2);
      const pulled = await run(["pull-page", "--project", project, "--file", file, "--yes"]);
      expect(pulled.code).toBe(0);
      expect(await readFile(join(vault, pulled.result.backupPath!), "utf8")).toContain("Local edits");
      expect((await run(["status", "--project", project])).result.reportScope).toBe("vault");
    });
  });

  it("pulls folder roots and non-JSON HTML attachments", async () => {
    await scenario(async ({ vault, run, init, state }) => {
      state.attachment = true;
      const project = await init(true);
      const pulled = await run(["pull-tree", "--project", project]);
      expect(pulled.code).toBe(0);
      expect(pulled.result.counts?.htmlAttachments).toBe(1);
      const html = pulled.result.completedPaths?.find((path) => path.endsWith(".html"));
      expect(html).toBeDefined();
      expect(await readFile(join(vault, html!), "utf8")).toContain("Prototype");
    });
  });

  it("blocks wrong-site sources, page id mismatches, legacy sources, and files outside the project before API calls", async () => {
    await scenario(async ({ vault, run, init, state, base }) => {
      const project = await init();
      await run(["pull-tree", "--project", project]);
      const file = `${project}/Root.md`;
      const original = await readFile(join(vault, file), "utf8");
      const before = state.requestCount;
      for (const value of [original.replace(base, "https://other.atlassian.net"), original.replace("pageId=100", "pageId=999"), original.replace(/^confluenceSourceUrl:.*\n/mu, "")]) {
        await writeFile(join(vault, file), value);
        const result = await run(["push-page", "--project", project, "--file", file, "--yes"]);
        expect(result.code).toBe(2);
        expect(result.result.reason).toBe("source-not-verified");
      }
      expect((await run(["pull-page", "--project", project, "--file", "../outside.md"])).code).toBe(2);
      expect(state.requestCount).toBe(before);
    });
  });

  it("does not force overwrite without confirmation or move pages after a partial fetch", async () => {
    await scenario(async ({ vault, run, init, state }) => {
      const project = await init();
      const initial = await run(["pull-tree", "--project", project]);
      const child = initial.result.completedPaths?.find((path) => path.endsWith("/Child.md"));
      expect(child).toBeDefined();
      const file = `${project}/Root.md`;
      const original = await readFile(join(vault, file), "utf8");
      await writeFile(join(vault, file), `${original}\nDraft\n`);
      expect((await run(["pull-tree", "--project", project, "--force"])).code).toBe(2);
      expect(await readFile(join(vault, file), "utf8")).toContain("Draft");
      state.failChild = true;
      const result = await run(["pull-tree", "--project", project, "--force", "--yes"]);
      expect(result.code).toBe(3);
      expect(result.result.counts?.safeDeleted).toBe(0);
      expect(await readFile(join(vault, child!), "utf8")).toContain("Original");
    });
  });

  it.each(["lost", "unreadable"] as const)("preserves the remote outcome on %s PUT response", async (mode) => {
    await scenario(async ({ vault, run, init, state }) => {
      const project = await init();
      await run(["pull-tree", "--project", project]);
      const file = `${project}/Root.md`;
      await writeFile(join(vault, file), `${await readFile(join(vault, file), "utf8")}\nDraft\n`);
      state.mode = mode;
      const result = await run(["push-page", "--project", project, "--file", file, "--yes"]);
      expect(result.code).toBe(3);
      expect(result.result.remoteState).toBe(mode === "lost" ? "unknown" : "applied");
      expect(state.putCount).toBe(1);
      expect(await readFile(join(vault, file), "utf8")).toContain("confluenceVersion: 1");
    });
  });

  it("retains actual applied counts when writing the latest report fails", async () => {
    await scenario(async ({ vault, run, init }) => {
      const project = await init();
      await mkdir(join(vault, "logs", "latest.md"), { recursive: true });
      const result = await run(["pull-tree", "--project", project]);
      expect(result.code).toBe(3);
      expect(result.result.reason).toBe("report-write-failed");
      expect(result.result.counts?.created).toBe(2);
      expect(result.result.reportPath).toBeNull();
      expect(result.result.reportWritten).toBe(false);
    });
  });

  it("shares the vault lock and protects paths and changed files", async () => {
    await scenario(async ({ vault, run, init }) => {
      const project = await init();
      await withVaultOperationLock(vault, async () => {
        expect((await run(["pull-tree", "--project", project])).result.reason).toBe("vault-locked");
      });
      const storage = createNodeVaultStorage(vault);
      await writeFile(join(vault, "draft.md"), "Original");
      await storage.read("draft.md");
      await writeFile(join(vault, "draft.md"), "Changed");
      await expect(storage.write("draft.md", "Remote")).rejects.toMatchObject({ reason: "local-changed" });
      await expect(storage.rename("draft.md", "removed.md")).rejects.toMatchObject({ reason: "local-changed" });
      expect(await storage.exists("new.md")).toBe(false);
      await writeFile(join(vault, "new.md"), "Another writer");
      await expect(storage.write("new.md", "Remote")).rejects.toMatchObject({ reason: "local-changed" });
      await symlink(tmpdir(), join(vault, "escape"), windows ? "junction" : "dir");
      await expect(storage.read("escape/file.md")).rejects.toMatchObject({ reason: "unsafe-path" });
      await expect(storage.read("../file.md")).rejects.toMatchObject({ reason: "unsafe-path" });
    });
  });

  it("reads existing vault settings without rewriting them and blocks malformed JSON", async () => {
    await scenario(async ({ vault, run, base, state }) => {
      const initialized = await run(["init", "--root", `${base}/wiki/spaces/S/pages/100`]);
      const settingsPath = join(vault, ".obsidian/plugins/confluence-obsidian-sync/data.json");
      await mkdir(join(vault, ".obsidian/plugins/confluence-obsidian-sync"), { recursive: true });
      const settings = JSON.stringify({ confluenceBaseUrl: base, userEmail: "stored@example.com", apiToken: "stored-token",
        currentProject: initialized.result.project, extraField: "preserve" });
      await writeFile(settingsPath, settings);
      expect((await run(["pull-tree"])).code).toBe(0);
      expect(await readFile(settingsPath, "utf8")).toBe(settings);
      await writeFile(settingsPath, "invalid JSON");
      const before = state.requestCount;
      expect((await run(["pull-tree"])).result.reason).toBe("invalid-config");
      expect(state.requestCount).toBe(before);
    });
  });

  it("blocks PUT if the local file changes during the version check", async () => {
    await scenario(async ({ vault }) => {
      const storage = createNodeVaultStorage(vault);
      const original = createPageMarkdownContent({ pageId: "100", title: "Root", versionNumber: 1,
        sourceUrl: "https://example.atlassian.net/wiki/pages/viewpage.action?pageId=100", parentId: null, bodyMarkdown: "Original\n" });
      await writeFile(join(vault, "file.md"), `${original}\nDraft\n`);
      let puts = 0;
      const result = await runPushCurrentPageCommand({
        settings: { confluenceBaseUrl: "https://example.atlassian.net", userEmail: "user", apiToken: "token", defaultRootContentUrl: "",
          defaultProjectFolder: "confluence", safeDeleteFolder: "trash", graphifyExecutablePath: "", graphifyTimeoutSeconds: 600, currentProject: null },
        storage, getActiveMarkdownFile: () => ({ path: "file.md" }), showNotice: () => undefined, confirmPush: () => true,
        fetchPage: async () => {
          await writeFile(join(vault, "file.md"), `${original}\nHuman edits\n`);
          return { ok: true, page: { pageId: "100", title: "Root", versionNumber: 1 } };
        },
        updatePage: () => { puts += 1; return Promise.resolve({ ok: true, page: { pageId: "100", title: "Root", versionNumber: 2 } }); }
      });
      expect(result).toMatchObject({ status: "blocked", reason: "local-changed", remoteState: "not-applied" });
      expect(puts).toBe(0);
      expect(await readFile(join(vault, "file.md"), "utf8")).toContain("Human edits");
    });
  });

  it("returns partial file progress rather than discarding completed writes", async () => {
    await scenario(async ({ vault }) => {
      const storage = createNodeVaultStorage(vault);
      const paths: string[] = [];
      const result = await writeMarkdownPages({ ...storage, write: async (path, data) => {
        if (paths.length) throw new Error("disk full");
        await storage.write(path, data); paths.push(path);
      } }, ["A", "B"].map((title) => ({ pageId: title, title, vaultPath: `${title}.md`, content: title, warnings: [] })));
      expect(result).toMatchObject({ ok: false, writtenFileCount: 1, completedPaths: ["A.md"], failedPath: "B.md", outcomeUnknown: true });
    });
  });

  it("preserves HTTP 200 on malformed JSON and rejects cross-site credential redirects", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/slow") return;
      if (request.url === "/redirect") { response.writeHead(302, { location: "https://other.example.com" }); response.end(); }
      else { response.writeHead(200, { "content-type": "application/json" }); response.end("bad json"); }
    });
    await new Promise<void>((ready) => { server.listen(0, "127.0.0.1", ready); });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test address missing");
      const base = `http://127.0.0.1:${address.port}`;
      const transport = createNodeRequestTransport(1000);
      expect(await transport({ url: base })).toMatchObject({ status: 200, bodyReadFailed: true });
      await expect(transport({ url: `${base}/redirect`, headers: { Authorization: "secret" } })).rejects.toThrow("인증 정보를 전달할 수 없습니다");
      await expect(createNodeRequestTransport(20)({ url: `${base}/slow` })).rejects.toThrow();
    } finally { await new Promise<void>((ready) => { server.close(() => ready()); }); }
  });

  it("follows only the attachment media redirect and strips all credential headers", async () => {
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/fake/binary" } }))
      .mockResolvedValueOnce(new Response("<html>attachment</html>", { status: 200, headers: { "content-type": "text/html" } }));
    try {
      const transport = createNodeRequestTransport();
      const result = await transport({ url: "https://example.atlassian.net/wiki/rest/api/content/100/child/attachment/att/download",
        headers: { Authorization: "secret", Cookie: "session=secret", "X-Private": "secret" } });
      expect(result).toMatchObject({ status: 200, redirectStatuses: [302], text: "<html>attachment</html>" });
      expect(request.mock.calls[1]?.[1]?.headers).toEqual({ Accept: "*/*" });
    } finally { request.mockRestore(); }
  });
});


describe("vault CLI distribution", () => {
  it("ships only standalone files with license notices and runs through the global entrypoint", async () => {
    const files = (await execute("tar", ["-tzf", join(installRoot, "이동한 vault/cli/confluence-sync-cli.tgz")])).stdout.trim().split("\n").sort();
    expect(files).toEqual(["LICENSE", "README.md", "THIRD-PARTY-NOTICES.txt", "cli.mjs", "package.json"].map((name) => `package/${name}`).sort());
    const prefix = installEnvironment.npm_config_prefix!;
    const directory = join(prefix, windows ? "node_modules" : "lib/node_modules", "confluence-obsidian-sync-cli");
    const info = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { version: string; engines: { node: string }; dependencies?: unknown; scripts?: unknown };
    expect(info.version).toBe(packageInfo.version);
    expect(info.engines.node).toBe(">=22");
    expect(info.dependencies).toBeUndefined(); expect(info.scripts).toBeUndefined();
    expect((await readFile(join(directory, "cli.mjs"), "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
    const notices = await readFile(join(directory, "THIRD-PARTY-NOTICES.txt"), "utf8");
    for (const license of ["ISC", "MIT", "BSD-2-Clause"]) expect(notices).toContain(license);
    expect(notices).toContain("boolbase@1.0.0");
    expect((await globalCommand(["--version"])).stdout).toContain(packageInfo.version);
    const help = (await globalCommand(["--help"])).stdout;
    expect(help).toContain("confluence-sync <명령> --vault <절대 경로>");
    expect(help).not.toContain("build:cli");
    if (!windows) {
      await expect(execute("confluence-sync", ["--version"], { cwd: installRoot, env: { ...installEnvironment, PATH: dirname(process.execPath) } }))
        .rejects.toMatchObject({ code: "ENOENT" });
      const restricted = join(installRoot, "権限なし"); await mkdir(restricted); await chmod(restricted, 0o500);
      try {
        await expect(npm(["install", "--global", "--engine-strict", "./이동한 vault/cli/confluence-sync-cli.tgz"], { ...installEnvironment, npm_config_prefix: restricted }))
          .rejects.toHaveProperty("stderr", expect.stringContaining("EACCES"));
      } finally { await chmod(restricted, 0o700); }
    }
    // import는 엔트리 실행과 구별된다.
    expect((await execute(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(join(directory, "cli.mjs")).href)})`, "unrelated-argument"], { cwd: installRoot })).stdout).toBe("");
  });

  it("uses the selected vault without storing a global default and requires the option", async () => {
    await scenario(async ({ vault, run, init }) => {
      const project = await init();
      expect((await run(["status", "--project", project])).code).toBe(0);
      const other = join(installRoot, "다른 vault"); await mkdir(other);
      await expect(globalCommand(["status", "--vault", other])).rejects.toHaveProperty("stdout", expect.stringContaining("project-not-configured"));
      expect(await readdir(other)).toEqual([]);
      await expect(globalCommand(["status"])).rejects.toMatchObject({ code: 1 });
      expect(vault).not.toBe(other);
    });
  });

  it("reinstalls and removes only the global program, preserving vault data and unrelated commands", async () => {
    const archive = "./이동한 vault/cli/confluence-sync-cli.tgz";
    const vault = join(installRoot, "이동한 vault");
    const sentinel = join(vault, "사용자 문서.md"); await writeFile(sentinel, "keep vault");
    const unrelated = join(dirname(installedCommand), "another-command"); await writeFile(unrelated, "keep command");
    const oldPackage = join(installRoot, "old-package"); await mkdir(oldPackage);
    await writeFile(join(oldPackage, "package.json"), JSON.stringify({ name: "confluence-obsidian-sync-cli", version: "0.1.0", bin: { "confluence-sync": "cli.cjs" } }));
    await writeFile(join(oldPackage, "cli.cjs"), '#!/usr/bin/env node\nconsole.log(JSON.stringify({ version: "0.1.0" }));\n');
    await npm(["pack", "./old-package", "--pack-destination", installRoot]);
    await npm(["install", "--global", "--engine-strict", "./confluence-obsidian-sync-cli-0.1.0.tgz"]);
    expect((await globalCommand(["--version"])).stdout).toContain("0.1.0");
    await npm(["install", "--global", "--engine-strict", archive]);
    await npm(["install", "--global", "--engine-strict", archive]);
    expect((await globalCommand(["--version"])).stdout).toContain(packageInfo.version);
    await npm(["uninstall", "--global", "confluence-obsidian-sync-cli"]);
    expect(await readFile(sentinel, "utf8")).toBe("keep vault");
    expect(await readFile(unrelated, "utf8")).toBe("keep command");
    await expect(readFile(installedCommand)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(installedCommand, "another program");
    await expect(npm(["install", "--global", "--engine-strict", archive])).rejects.toMatchObject({ code: 1 });
    expect(await readFile(installedCommand, "utf8")).toBe("another program");
  }, 30000);
});
