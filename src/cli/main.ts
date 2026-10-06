#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import packageInfo from "../../package.json";
import { finishCommand, commandExitCode, type CommandResult } from "../commands/commandResult";
import { runPullTreeCommand } from "../commands/pullTreeCommand";
import { runPullCurrentPageCommand } from "../commands/pullCurrentPageCommand";
import { runPushCurrentPageCommand } from "../commands/pushCurrentPageCommand";
import { createNodeRequestTransport } from "../confluence/nodeRequestTransport";
import { checkConfluenceConnection } from "../confluence/connectionCheck";
import { getMissingConfluenceConnectionFields } from "../confluence/authentication";
import { parseConfluenceRootUrl } from "../confluence/pageUrl";
import { createNodeVaultStorage } from "../platform/nodeVaultStorage";
import { VaultLockedError, withVaultOperationLock } from "../platform/vaultOperationLock";
import { StorageGuardError } from "../projects/storageFailure";
import { createProjectFromRootUrl } from "../projects/createProjectFromRootUrl";
import { parsePullReportMarkdown } from "../projects/pullReport";
import { loadConfluenceSyncSettings, type ConfluenceSyncSettings, type CurrentConfluenceProjectSettings } from "../settings/defaultSettings";

const commands = ["check", "status", "init", "pull-tree", "pull-page", "push-page"];
const silentNotice = () => undefined;

class CliInputError extends Error {
  constructor(public readonly reason: string, message: string) { super(message); }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CliInputError("invalid-config", "설정 또는 manifest 형식이 올바르지 않습니다.");
  return value as Record<string, unknown>;
}

function sameSite(left: string, right: string): boolean {
  try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
}

function validateConnectionUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new CliInputError("invalid-url", "Confluence base URL이 올바르지 않습니다."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash ||
    !["", "/", "/wiki", "/wiki/"].includes(parsed.pathname)) {
    throw new CliInputError("invalid-url", "Confluence base URL에는 HTTPS 사이트 주소 또는 /wiki 경로를 사용하세요.");
  }
}

async function readSettings(storage: ReturnType<typeof createNodeVaultStorage>, environment: NodeJS.ProcessEnv): Promise<ConfluenceSyncSettings> {
  const path = ".obsidian/plugins/confluence-obsidian-sync/data.json";
  let stored: Record<string, unknown> = {};
  if (await storage.exists(path)) {
    try { stored = record(JSON.parse(await storage.read(path)) as unknown); }
    catch { throw new CliInputError("invalid-config", "플러그인 data.json을 읽을 수 없습니다. JSON과 파일 접근 권한을 확인하세요."); }
  }
  for (const field of ["confluenceBaseUrl", "userEmail", "apiToken", "defaultProjectFolder", "safeDeleteFolder", "graphifyExecutablePath"]) {
    if (stored[field] !== undefined && typeof stored[field] !== "string") throw new CliInputError("invalid-config", `설정 필드 형식이 올바르지 않습니다: ${field}`);
  }
  const settings = await loadConfluenceSyncSettings(() => Promise.resolve(stored));
  if (stored.currentProject != null && settings.currentProject === null) throw new CliInputError("invalid-config", "현재 프로젝트 설정이 올바르지 않습니다.");
  settings.confluenceBaseUrl = environment.CONFLUENCE_BASE_URL ?? (stored.confluenceBaseUrl as string | undefined) ?? "";
  settings.userEmail = environment.CONFLUENCE_USER_EMAIL ?? (stored.userEmail as string | undefined) ?? "";
  settings.apiToken = environment.CONFLUENCE_API_TOKEN ?? (stored.apiToken as string | undefined) ?? "";
  return settings;
}

async function selectProject(storage: ReturnType<typeof createNodeVaultStorage>, settings: ConfluenceSyncSettings, projectPath?: string): Promise<CurrentConfluenceProjectSettings> {
  const configured = settings.currentProject;
  const folder = projectPath ?? configured?.localFolderPath;
  if (!folder) throw new CliInputError("project-not-configured", "--project를 지정하거나 init으로 프로젝트를 생성하세요.");
  const manifestPath = `${folder.replace(/\/+$/u, "")}/.confluence-sync/manifest.json`;
  await storage.resolvePath(folder);
  let manifest: Record<string, unknown>;
  try { manifest = record(JSON.parse(await storage.read(manifestPath)) as unknown); }
  catch { throw new CliInputError("invalid-manifest", "프로젝트 manifest를 읽을 수 없습니다."); }
  for (const field of ["projectName", "spaceId", "rootUrl", "localFolderPath", "confluenceBaseUrl"]) {
    if (typeof manifest[field] !== "string" || !manifest[field]) throw new CliInputError("invalid-manifest", `manifest 필드가 올바르지 않습니다: ${field}`);
  }
  if (await storage.resolvePath(manifest.localFolderPath as string) !== await storage.resolvePath(folder)) throw new CliInputError("project-mismatch", "manifest의 프로젝트 폴더가 선택한 경로와 다릅니다.");
  const rootType = manifest.rootContentType ?? "page";
  const rootId = manifest.rootContentId ?? manifest.rootPageId;
  if ((rootType !== "page" && rootType !== "folder") || typeof rootId !== "string" || !rootId) throw new CliInputError("invalid-manifest", "manifest 루트 정보가 올바르지 않습니다.");
  const base = manifest.confluenceBaseUrl as string;
  validateConnectionUrl(base);
  if (settings.confluenceBaseUrl && !sameSite(base, settings.confluenceBaseUrl)) throw new CliInputError("site-mismatch", "프로젝트와 인증 설정의 Confluence 사이트가 다릅니다.");
  const root = parseConfluenceRootUrl(manifest.rootUrl as string, base);
  if (!root.ok || root.rootContentType !== rootType || root.rootContentId !== rootId) throw new CliInputError("invalid-manifest", "manifest 루트 URL과 식별자가 일치하지 않습니다.");
  if (!projectPath && configured && (await storage.resolvePath(configured.manifestPath) !== await storage.resolvePath(manifestPath) || configured.rootContentType !== rootType || configured.rootContentId !== rootId)) {
    throw new CliInputError("project-mismatch", "현재 프로젝트 설정과 manifest가 일치하지 않습니다.");
  }
  return { projectName: manifest.projectName as string, spaceId: manifest.spaceId as string,
    rootContentType: rootType, rootContentId: rootId, rootPageId: rootType === "page" ? rootId : "",
    rootUrl: manifest.rootUrl as string, localFolderPath: manifest.localFolderPath as string, manifestPath };
}

export async function runCli(args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<CommandResult & {
  command: string; project?: CurrentConfluenceProjectSettings; reportScope?: string;
  latestReport?: ReturnType<typeof parsePullReportMarkdown>; supportedCommands?: string[]; options?: Record<string, string>; version?: string;
}> {
  let command = "";
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      vault: { type: "string" }, project: { type: "string" }, file: { type: "string" }, root: { type: "string" },
      force: { type: "boolean" }, yes: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" }
    } });
    command = positionals[0] ?? "help";
    if (values.version) return { command: "version", status: "success", reason: "version", message: packageInfo.version, version: packageInfo.version };
    if (values.help || command === "help") return { command: "help", status: "success", reason: "help", message: "confluence-sync <명령> --vault <절대 경로>로 실행합니다.", supportedCommands: commands,
      options: { "--vault": "모든 명령: 이미 존재하는 vault의 절대 경로", "--project": "status/Pull/Push: 프로젝트 폴더의 vault 상대 경로",
        "--root": "init: Confluence 페이지·폴더 URL", "--file": "pull-page/push-page: Markdown 파일의 vault 상대 경로",
        "--force": "pull-tree: 백업 없이 강제 덮어쓰기", "--yes": "Pull/Push: 위험한 작업의 명시적 확인" } };
    if (!commands.includes(command) || positionals.length !== 1) throw new CliInputError("invalid-command", "지원되는 명령 하나를 지정하세요.");
    if (!values.vault || !isAbsolute(values.vault)) throw new CliInputError("missing-vault", "--vault에는 vault의 절대 경로가 필요합니다.");
    if ((values.force !== undefined && command !== "pull-tree") || (values.root !== undefined && command !== "init") ||
      (values.file !== undefined && !["pull-page", "push-page"].includes(command)) ||
      (values.project !== undefined && ["check", "init"].includes(command)) ||
      (values.yes !== undefined && ["check", "status", "init"].includes(command))) {
      throw new CliInputError("invalid-option", "명령에 사용할 수 없는 옵션이 지정됐습니다.");
    }
    const vault = values.vault;
    const execute = async () => {
      const storage = createNodeVaultStorage(vault);
      await storage.resolvePath("");
      const settings = await readSettings(storage, environment);
      const transport = createNodeRequestTransport();
      if (command !== "status") {
        if (getMissingConfluenceConnectionFields(settings).length) throw new CliInputError("missing-settings", "Confluence base URL, 이메일, API token을 플러그인 설정 또는 환경변수로 지정하세요.");
        validateConnectionUrl(settings.confluenceBaseUrl);
      }
      if (command === "check") {
        const checked = await checkConfluenceConnection(settings, transport);
        return checked.ok ? finishCommand(silentNotice, "success", "connected", "Confluence 연결 확인에 성공했습니다.")
          : finishCommand(silentNotice, "error", checked.reason, checked.message);
      }
      if (command === "init") {
        if (!values.root) throw new CliInputError("missing-root", "init에는 명시적인 --root URL이 필요합니다.");
        const created = await createProjectFromRootUrl({ settings, rawRootUrl: values.root, transport, storage, now: () => new Date() });
        return created.ok ? { ...finishCommand(silentNotice, "success", "initialized", created.message), project: created.currentProject }
          : finishCommand(silentNotice, "error", "initialization-failed", created.message);
      }
      const project = await selectProject(storage, settings, values.project);
      settings.currentProject = project;
      if (command === "status") {
        const reportExists = await storage.exists("logs/latest.md");
        const latestReport = reportExists ? parsePullReportMarkdown(await storage.read("logs/latest.md")) : null;
        return { ...finishCommand(silentNotice, "success", "status", "선택한 프로젝트와 vault 공용 최신 Pull 리포트입니다."), project, reportScope: "vault", reportPath: reportExists ? "logs/latest.md" : null, latestReport };
      }
      if (command === "pull-tree") return runPullTreeCommand({ settings, storage, transport, mode: values.force ? "force" : "normal",
        confirmForcePull: () => values.yes === true, showNotice: silentNotice });
      if (!values.file || !values.file.toLowerCase().endsWith(".md")) throw new CliInputError("missing-file", "--file에 vault 기준 Markdown 파일 경로를 지정하세요.");
      const file = await storage.resolvePath(values.file);
      const projectRoot = await storage.resolvePath(project.localFolderPath);
      const within = relative(projectRoot, file);
      if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`) || !within) throw new CliInputError("file-outside-project", "문서는 선택한 프로젝트 내부에 있어야 합니다.");
      const filePath = values.file;
      const common = { settings, storage, transport, verifySource: true, getActiveMarkdownFile: () => ({ path: filePath }), showNotice: silentNotice };
      if (command === "pull-page") return runPullCurrentPageCommand({ ...common, confirmOverwriteLocalChanges: () => values.yes === true });
      return runPushCurrentPageCommand({ ...common, confirmPush: () => values.yes === true });
    };
    const result = ["check", "status"].includes(command) ? await execute() : await withVaultOperationLock(vault, execute);
    return { command, ...result };
  } catch (error) {
    if (error instanceof VaultLockedError) return { command, status: "blocked", reason: "vault-locked", message: error.message };
    if (error instanceof StorageGuardError) return { command, status: "blocked", reason: error.reason, message: error.message };
    const blocked = error instanceof CliInputError && ["file-outside-project", "site-mismatch", "project-mismatch"].includes(error.reason);
    return { command, status: blocked ? "blocked" : "error", reason: error instanceof CliInputError ? error.reason : "operation-failed",
      message: error instanceof CliInputError ? error.message : "CLI 작업을 완료하지 못했습니다. 옵션·파일 접근 권한·연결 설정을 확인하세요." };
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = await runCli(process.argv.slice(2));
  let output = JSON.stringify(result);
  for (const value of [process.env.CONFLUENCE_API_TOKEN, process.env.CONFLUENCE_USER_EMAIL]) {
    if (value) output = output.replaceAll(value, "[redacted]");
  }
  process.stdout.write(`${output}\n`);
  process.exitCode = commandExitCode(result);
}
