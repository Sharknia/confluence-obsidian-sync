import { execFile } from "node:child_process";
import console from "node:console";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

if (process.env.GRAPHIFY_SMOKE !== "1") {
  console.log("GRAPHIFY_SMOKE=1 is not set; skipping optional graphify smoke test.");
  process.exit(0);
}

const tempVaultPath = await mkdtemp(join(tmpdir(), "graphify-smoke-"));
const graphifyExecutable = process.env.GRAPHIFY_EXECUTABLE?.trim() || "graphify";

try {
  let preflightOutput = "";

  try {
    const result = await execFileAsync(graphifyExecutable, ["--version"], { timeout: 3000 });
    preflightOutput = `${result.stdout}\n${result.stderr}`;
  } catch (versionError) {
    const stdout = typeof versionError === "object" && versionError !== null && "stdout" in versionError ? String(versionError.stdout) : "";
    const stderr = typeof versionError === "object" && versionError !== null && "stderr" in versionError ? String(versionError.stderr) : "";
    const message = versionError instanceof Error ? versionError.message : "";
    const lowerOutput = `${stdout}\n${stderr}\n${message}`.toLowerCase();
    const canFallbackToHelp =
      lowerOutput.includes("version") &&
      (lowerOutput.includes("unknown") || lowerOutput.includes("no such option") || lowerOutput.includes("unrecognized"));

    if (!canFallbackToHelp) {
      throw versionError;
    }

    const result = await execFileAsync(graphifyExecutable, ["--help"], { timeout: 3000 });
    preflightOutput = `${result.stdout}\n${result.stderr}`;
  }

  const looksLikeGraphify = preflightOutput
    .split(/\r?\n/u)
    .some((line) => /^(graphify(\s|$)|usage:\s*graphify(\s|$))/u.test(line.trim().toLowerCase()));

  if (!looksLikeGraphify) {
    throw new Error(`Configured executable does not look like graphify: ${graphifyExecutable}`);
  }

  await checkInstalledAgentRunnerHelp();

  const corpusPath = join(tempVaultPath, "confluence", "sample");
  await mkdir(corpusPath, { recursive: true });
  await writeFile(join(corpusPath, "note.md"), "# Sample\n\nGraphify smoke corpus.\n");
  await writeFile(join(corpusPath, "sample.ts"), "export function sampleGraphNode(): string {\n  return \"graphify\";\n}\n");

  // graphify update는 코드 파일 재추출용이다. Markdown 문서 corpus는 agent skill의 /graphify <path> 경로로 검증한다.
  await execFileAsync(graphifyExecutable, ["update", "confluence/sample"], {
    cwd: tempVaultPath,
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024
  });

  await mkdir(join(tempVaultPath, "graphify-out"), { recursive: true });

  for (const fileName of ["GRAPH_REPORT.md", "graph.json", "graph.html"]) {
    const generatedOutputPath = join(corpusPath, "graphify-out", fileName);
    const outputPath = join(tempVaultPath, "graphify-out", fileName);

    if (existsSync(generatedOutputPath)) {
      await copyFile(generatedOutputPath, outputPath);
    }

    if (!existsSync(outputPath)) {
      throw new Error(`Missing expected graphify output: ${outputPath}`);
    }
  }

  const graphJson = JSON.parse(await readFile(join(tempVaultPath, "graphify-out", "graph.json"), "utf8"));
  const nodes = Array.isArray(graphJson.nodes) ? graphJson.nodes : Array.isArray(graphJson.graph?.nodes) ? graphJson.graph.nodes : [];

  if (nodes.length === 0) {
    throw new Error("graphify smoke produced graph.json without nodes.");
  }

  if (process.env.GRAPHIFY_AGENT_SMOKE === "1") {
    const markdownOnlyCorpusPath = join(tempVaultPath, "confluence", "markdown-sample");

    await mkdir(markdownOnlyCorpusPath, { recursive: true });
    await writeFile(join(markdownOnlyCorpusPath, "note.md"), "# Markdown Sample\n\nGraphify agent smoke corpus.\n");
    await runAgentGraphifySmoke(tempVaultPath, "confluence/markdown-sample");
    await assertGraphifyOutputHasNodes(tempVaultPath);
  }

  console.log("graphify smoke test passed.");
} finally {
  await rm(tempVaultPath, { recursive: true, force: true });
}

async function runAgentGraphifySmoke(vaultPath, projectFolderPath) {
  const runner = await detectAgentRunner();
  const command = `/graphify ${projectFolderPath}`;

  if (runner === "claude") {
    await execFileAsync("claude", ["-p", "--permission-mode", "acceptEdits", command], {
      cwd: vaultPath,
      timeout: 600_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return;
  }

  if (runner === "opencode") {
    await execFileAsync("opencode", ["run", "--dir", vaultPath, command], {
      cwd: vaultPath,
      timeout: 600_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return;
  }

  await execFileAsync("codex", ["exec", "--cd", vaultPath, "--sandbox", "workspace-write", "--full-auto", command], {
    cwd: vaultPath,
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function detectAgentRunner() {
  const configuredRunner = process.env.GRAPHIFY_AGENT_RUNNER?.trim();
  const candidates = configuredRunner === undefined || configuredRunner.length === 0 ? ["claude", "opencode", "codex"] : [configuredRunner];

  for (const runner of candidates) {
    if (await executableExists(runner)) {
      return runner;
    }
  }

  throw new Error("GRAPHIFY_AGENT_SMOKE=1 requires claude, opencode, or codex on PATH.");
}

async function assertGraphifyOutputHasNodes(vaultPath) {
  for (const fileName of ["GRAPH_REPORT.md", "graph.json", "graph.html"]) {
    const outputPath = join(vaultPath, "graphify-out", fileName);

    if (!existsSync(outputPath)) {
      throw new Error(`Missing expected agent graphify output: ${outputPath}`);
    }
  }

  const graphJson = JSON.parse(await readFile(join(vaultPath, "graphify-out", "graph.json"), "utf8"));
  const nodes = Array.isArray(graphJson.nodes) ? graphJson.nodes : Array.isArray(graphJson.graph?.nodes) ? graphJson.graph.nodes : [];

  if (nodes.length === 0) {
    throw new Error("agent graphify smoke produced graph.json without nodes.");
  }
}

async function checkInstalledAgentRunnerHelp() {
  for (const runner of ["claude", "opencode", "codex"]) {
    if (!(await executableExists(runner))) {
      continue;
    }

    await execFileAsync(runner, ["--help"], {
      timeout: 3000,
      maxBuffer: 1024 * 1024
    });
  }
}

async function executableExists(executable) {
  try {
    await execFileAsync("which", [executable], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
