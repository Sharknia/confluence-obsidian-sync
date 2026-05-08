export interface GraphifyProcessResult {
  stdout: string;
  stderr: string;
}

export interface GraphifyRunOptions {
  cwd?: string;
  timeoutMilliseconds: number;
  maxBufferBytes?: number;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

export type GraphifyExecutableRunner = (
  executable: string,
  args: string[],
  options: GraphifyRunOptions
) => Promise<GraphifyProcessResult>;

export interface GraphifyAvailability {
  installed: boolean;
  executable: string;
  message: string;
}

export type GraphifyRunStatusKind = "idle" | "running" | "success" | "failure";

export interface GraphifyRunStatus {
  kind: GraphifyRunStatusKind;
  message: string;
}

export type GraphifyOutputOpenKind = "markdown" | "vault" | "external";

export interface GraphifyOutputFileState {
  label: string;
  path: string;
  exists: boolean;
  openKind: GraphifyOutputOpenKind;
}

export type VaultRelativeProjectPathValidation = { ok: true; path: string } | { ok: false; message: string };

export function resolveGraphifyExecutable(configuredExecutablePath: string): string {
  const trimmedPath = configuredExecutablePath.trim();

  return trimmedPath.length > 0 ? trimmedPath : "graphify";
}

export async function checkGraphifyAvailability({
  executable,
  runExecutable
}: {
  executable: string;
  runExecutable: GraphifyExecutableRunner;
}): Promise<GraphifyAvailability> {
  try {
    const result = await runExecutable(executable, ["--version"], {
      cwd: undefined,
      timeoutMilliseconds: 3_000
    });
    const helpText = getFirstOutputLine(result);

    if (!looksLikeGraphifyOutput(helpText)) {
      return createNotGraphifyAvailability(executable);
    }

    return {
      installed: true,
      executable,
      message: helpText.length > 0 ? helpText : "graphify를 실행할 수 있습니다."
    };
  } catch (versionError) {
    if (!shouldTryGraphifyHelpFallback(versionError)) {
      return {
        installed: false,
        executable,
        message: formatGraphifyAvailabilityFailure(versionError)
      };
    }

    try {
      const result = await runExecutable(executable, ["--help"], {
        cwd: undefined,
        timeoutMilliseconds: 3_000
      });
      const helpText = getFirstOutputLine(result);

      if (!looksLikeGraphifyOutput(helpText)) {
        return createNotGraphifyAvailability(executable);
      }

      return {
        installed: true,
        executable,
        message: `graphify 실행 파일을 찾았습니다: ${executable}`
      };
    } catch (helpError) {
      return {
        installed: false,
        executable,
        message: formatGraphifyAvailabilityFailure(helpError, versionError)
      };
    }
  }
}

export function createGraphifyRunArguments(projectFolderPath: string): string[] {
  return ["update", projectFolderPath];
}

export async function buildGraphifyOutputFileStates({
  exists
}: {
  exists: (path: string) => Promise<boolean>;
}): Promise<GraphifyOutputFileState[]> {
  const outputFiles = [
    { label: "GRAPH_REPORT.md", fileName: "GRAPH_REPORT.md", openKind: "markdown" as const },
    { label: "graph.json", fileName: "graph.json", openKind: "external" as const },
    { label: "graph.html", fileName: "graph.html", openKind: "external" as const }
  ];

  return Promise.all(
    outputFiles.map(async (outputFile) => {
      const path = joinVaultPath("graphify-out", outputFile.fileName);

      return {
        label: outputFile.label,
        path,
        exists: await exists(path).catch(() => false),
        openKind: outputFile.openKind
      };
    })
  );
}

export function isKnownGraphifyOutputPath(path: string): boolean {
  return ["graphify-out/GRAPH_REPORT.md", "graphify-out/graph.json", "graphify-out/graph.html"].includes(path);
}

export function validateVaultRelativeProjectPath(rawPath: string): VaultRelativeProjectPathValidation {
  const normalizedPath = rawPath.trim().replace(/\\/gu, "/");

  if (normalizedPath.length === 0 || normalizedPath.startsWith("/") || /^[A-Za-z]:\//u.test(normalizedPath)) {
    return {
      ok: false,
      message: "graphify 실행 폴더는 vault 내부 상대 경로여야 합니다."
    };
  }

  if (normalizedPath.split("/").some((pathPart) => pathPart === "..")) {
    return {
      ok: false,
      message: "graphify 실행 폴더가 vault 밖을 가리킬 수 없습니다."
    };
  }

  return {
    ok: true,
    path: normalizedPath
  };
}

export function formatGraphifyFailureMessage({
  error,
  stderr,
  stdout
}: {
  error: unknown;
  stdout: string;
  stderr: string;
}): string {
  const detail = stderr.trim() || stdout.trim() || getErrorMessage(error);
  const normalizedDetail = detail.replace(/\s+/gu, " ").trim() || "알 수 없는 오류";
  const maxDetailLength = 320;
  const clippedDetail =
    normalizedDetail.length > maxDetailLength ? `${normalizedDetail.slice(0, maxDetailLength - 1)}...` : normalizedDetail;

  return `graphify 실행 실패: ${clippedDetail}`;
}

function getFirstOutputLine(result: GraphifyProcessResult): string {
  return (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/u)[0]?.trim() ?? "";
}

function looksLikeGraphifyOutput(output: string | undefined): boolean {
  if (typeof output !== "string") {
    return false;
  }

  return output
    .split(/\r?\n/u)
    .some((line) => /^(graphify(\s|$)|usage:\s*graphify(\s|$))/u.test(line.trim().toLowerCase()));
}

function shouldTryGraphifyHelpFallback(error: unknown): boolean {
  const output = getProcessOutput(error).toLowerCase();

  return (
    output.includes("version") &&
    (output.includes("unknown") || output.includes("no such option") || output.includes("unrecognized"))
  );
}

function createNotGraphifyAvailability(executable: string): GraphifyAvailability {
  return {
    installed: false,
    executable,
    message: "graphify 실행 파일이 아닌 것 같습니다. 설정 경로를 확인하세요."
  };
}

function formatGraphifyAvailabilityFailure(error: unknown, fallbackError?: unknown): string {
  const code = getErrorCode(error);

  if (code === "ENOENT") {
    return "graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요.";
  }

  if (code === "EACCES") {
    return "graphify 실행 권한이 없습니다. 실행 파일 권한과 설정 경로를 확인하세요.";
  }

  if (code === "ETIMEDOUT") {
    return "graphify 확인 시간이 초과되었습니다. 실행 경로가 올바른지 확인하세요.";
  }

  const output = getProcessOutput(error);
  const detail = output || getErrorMessage(error) || getErrorMessage(fallbackError);

  return `graphify를 실행할 수 없습니다: ${detail}`;
}

function joinVaultPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("/");
}

function getErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

function getProcessOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const record = error as Record<string, unknown>;
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
  const message = error instanceof Error ? error.message.trim() : "";

  return stderr || stdout || message;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
