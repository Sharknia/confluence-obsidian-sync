import {
  createGraphifyRunArguments,
  formatGraphifyFailureMessage,
  isKnownGraphifyOutputPath,
  validateVaultRelativeProjectPath,
  type GraphifyAvailability,
  type GraphifyExecutableRunner,
  type GraphifyOutputFileState,
  type GraphifyRunStatus
} from "./graphifyCli";
import { buildGraphifyAgentRunCommand, type GraphifyAgentRunnerKind } from "./graphifyAgentRunner";

export type GraphifyRunMode =
  | { kind: "cli-code-update" }
  | { kind: "agent-skill"; runner: GraphifyAgentRunnerKind; runnerExecutable: string };

export type GraphifyOutputVerification = { ok: true } | { ok: false; missingFiles: string[] };

export function createCachedGraphifyAvailabilityChecker({
  checkAvailability,
  now,
  ttlMilliseconds
}: {
  checkAvailability: (executable: string) => Promise<GraphifyAvailability>;
  now: () => number;
  ttlMilliseconds: number;
}): (executable: string) => Promise<GraphifyAvailability> {
  let cache: { executable: string; checkedAt: number; availability: GraphifyAvailability } | null = null;

  return async (executable) => {
    const currentTime = now();

    if (cache !== null && cache.executable === executable && currentTime - cache.checkedAt < ttlMilliseconds) {
      return cache.availability;
    }

    const availability = await checkAvailability(executable);
    cache = { executable, checkedAt: currentTime, availability };

    return availability;
  };
}

export async function runGraphifyForProject({
  currentRunStatus,
  projectFolderPath,
  executable,
  vaultBasePath,
  timeoutMilliseconds,
  projectFolderExists,
  runExecutable,
  copyGeneratedOutputToVaultRoot,
  verifyGraphifyOutputFiles,
  writeGraphifyRunLog,
  setStatus,
  showNotice,
  confirmGraphifyAgentRun,
  graphifyRunMode
}: {
  currentRunStatus: GraphifyRunStatus;
  projectFolderPath: string;
  executable: string;
  vaultBasePath: string;
  timeoutMilliseconds: number;
  projectFolderExists: (vaultRelativePath: string) => Promise<boolean>;
  runExecutable: GraphifyExecutableRunner;
  copyGeneratedOutputToVaultRoot?: (projectFolderPath: string) => Promise<void>;
  verifyGraphifyOutputFiles?: () => Promise<GraphifyOutputVerification>;
  writeGraphifyRunLog?: (log: string) => Promise<void>;
  setStatus: (status: GraphifyRunStatus) => Promise<void>;
  showNotice: (message: string) => void;
  confirmGraphifyAgentRun: (message: string) => boolean;
  graphifyRunMode: GraphifyRunMode;
}): Promise<void> {
  if (currentRunStatus.kind === "running") {
    await setStatus({ kind: "running", message: "graphify 실행 중입니다..." });
    return;
  }

  const validation = validateVaultRelativeProjectPath(projectFolderPath);

  if (!validation.ok) {
    await setStatus({ kind: "failure", message: validation.message });
    return;
  }

  let exists: boolean;

  try {
    exists = await projectFolderExists(validation.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";

    await setStatus({ kind: "failure", message: `graphify 실행 폴더를 확인할 수 없습니다: ${message}` });
    return;
  }

  if (!exists) {
    await setStatus({ kind: "failure", message: "graphify 실행 폴더가 존재하지 않습니다. 먼저 Pull Tree를 실행하세요." });
    return;
  }

  let liveOutput = "";
  const logLines = [`command: ${graphifyRunMode.kind === "agent-skill" ? graphifyRunMode.runner : executable}`, `cwd: ${vaultBasePath}`];
  const runningMessage = "graphify 실행 중입니다...";
  const appendLiveOutput = (chunk: string): void => {
    const normalizedChunk = chunk.replace(/\r/gu, "").trimEnd();

    if (normalizedChunk.length === 0) {
      return;
    }

    logLines.push(normalizedChunk);
    liveOutput = clipGraphifyLiveOutput(`${liveOutput}${liveOutput.length === 0 ? "" : "\n"}${normalizedChunk}`);
    void setStatus({ kind: "running", message: `${runningMessage}\n\n${liveOutput}` });
  };

  void setStatus({ kind: "running", message: runningMessage });

  try {
    if (graphifyRunMode.kind === "agent-skill") {
      const confirmed = confirmGraphifyAgentRun(
        "graphify 문서 분석은 외부 agent skill을 실행합니다. LLM/subagent 실행, 파일 읽기/쓰기, 장시간 실행, 비용 발생 가능성이 있습니다. 계속할까요?"
      );

      if (!confirmed) {
        await setStatus({ kind: "idle", message: "graphify 실행을 취소했습니다." });
        return;
      }
    }

    const command =
      graphifyRunMode.kind === "agent-skill"
        ? buildGraphifyAgentRunCommand({
            runner: graphifyRunMode.runner,
            runnerExecutable: graphifyRunMode.runnerExecutable,
            vaultBasePath,
            projectFolderPath: validation.path
          })
        : {
            executable,
            args: createGraphifyRunArguments(validation.path),
            cwd: vaultBasePath
          };

    await runExecutable(command.executable, command.args, {
      cwd: command.cwd,
      timeoutMilliseconds,
      maxBufferBytes: 10 * 1024 * 1024,
      onOutput: appendLiveOutput
    });
    if (graphifyRunMode.kind === "cli-code-update") {
      await copyGeneratedOutputToVaultRoot?.(validation.path);
    }
    await writeGraphifyRunLog?.(buildGraphifyRunLog(logLines));
    const outputVerification = await verifyGraphifyOutputFiles?.();

    if (outputVerification !== undefined && !outputVerification.ok) {
      const message = formatMissingGraphifyOutputMessage(outputVerification.missingFiles, liveOutput);

      await setStatus({ kind: "failure", message });
      showNotice(message);
      return;
    }

    await setStatus({ kind: "success", message: "graphify 실행이 완료되었습니다." });
    showNotice("graphify 실행이 완료되었습니다.");
  } catch (error) {
    const processError = error as Partial<{ stdout: string; stderr: string }>;
    const fallbackOutput = [processError.stdout, processError.stderr]
      .filter((output): output is string => typeof output === "string" && output.trim().length > 0)
      .join("\n");

    if (fallbackOutput.length > 0 && liveOutput.length === 0) {
      logLines.push(fallbackOutput);
    }

    await writeGraphifyRunLog?.(buildGraphifyRunLog(logLines)).catch(() => undefined);
    const message = formatGraphifyFailureMessage({
      error,
      stdout: typeof processError.stdout === "string" ? processError.stdout : "",
      stderr: typeof processError.stderr === "string" ? processError.stderr : ""
    });
    await setStatus({ kind: "failure", message });
    showNotice(message);
  }
}

function clipGraphifyLiveOutput(output: string): string {
  const maxLength = 4_000;

  return output.length <= maxLength ? output : output.slice(output.length - maxLength);
}

function buildGraphifyRunLog(logLines: string[]): string {
  return `${logLines.join("\n")}\n`;
}

function formatMissingGraphifyOutputMessage(missingFiles: string[], liveOutput: string): string {
  const missingText = missingFiles.length > 0 ? missingFiles.join(", ") : "알 수 없는 결과 파일";
  const logHint = "graphify-out/latest-run.log";
  const recentOutput = liveOutput.trim();

  if (recentOutput.length === 0) {
    return `graphify 실행 실패: 결과 파일이 생성되지 않았습니다: ${missingText}. 자세한 로그: ${logHint}`;
  }

  return `graphify 실행 실패: 결과 파일이 생성되지 않았습니다: ${missingText}. 자세한 로그: ${logHint}\n\n최근 로그:\n${recentOutput}`;
}

export async function openGraphifyOutputFile({
  outputFile,
  openMarkdown,
  openVaultPath,
  openExternalUrl,
  toFileUrl,
  showNotice
}: {
  outputFile: GraphifyOutputFileState;
  openMarkdown: (path: string) => Promise<void>;
  openVaultPath: (path: string) => Promise<void>;
  openExternalUrl: (url: string, target: string, features: string) => boolean;
  toFileUrl: (path: string) => string;
  showNotice: (message: string) => void;
}): Promise<void> {
  if (!isKnownGraphifyOutputPath(outputFile.path)) {
    showNotice("알 수 없는 graphify 결과 파일은 열 수 없습니다.");
    return;
  }

  try {
    if (outputFile.openKind === "markdown") {
      await openMarkdown(outputFile.path);
      return;
    }

    if (outputFile.openKind === "vault") {
      await openVaultPath(outputFile.path);
      return;
    }

    const opened = openExternalUrl(toFileUrl(outputFile.path), "_blank", "noopener,noreferrer");

    if (!opened) {
      throw new Error(`브라우저가 ${outputFile.label} 열기를 거부했습니다.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";

    showNotice(`graphify 결과 파일을 열 수 없습니다: ${message}`);
  }
}
