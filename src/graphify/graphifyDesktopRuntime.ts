import type { GraphifyExecutableRunner } from "./graphifyCli";

export type DesktopRequire = (moduleName: string) => unknown;

export function getDesktopRequire(globalLike: { require?: unknown } = globalThis): DesktopRequire | null {
  if (isDesktopRequire(globalLike.require)) {
    return globalLike.require;
  }

  return null;
}

export function createNodeExecutableRunner(nodeRequire: DesktopRequire | null): GraphifyExecutableRunner | null {
  if (nodeRequire === null) {
    return null;
  }

  let childProcess: typeof import("child_process");
  const environment = createGraphifyExecutionEnvironment(nodeRequire);

  try {
    childProcess = nodeRequire("child_process") as typeof import("child_process");
  } catch {
    return null;
  }

  return (executable, args, options) =>
    new Promise((resolve, reject) => {
      const child = childProcess.execFile(
        executable,
        args,
        {
          cwd: options.cwd,
          env: environment,
          timeout: options.timeoutMilliseconds,
          windowsHide: true,
          maxBuffer: options.maxBufferBytes ?? 10 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            const normalizedError =
              typeof error === "object" && "killed" in error && error.killed === true
                ? (Object.assign(error, { code: "ETIMEDOUT", stdout, stderr }) as Error)
                : (Object.assign(error, { stdout, stderr }) as Error);

            reject(normalizedError);
            return;
          }

          resolve({ stdout, stderr });
        }
      );

      child?.stdout?.on("data", (chunk) => {
        options.onOutput?.(String(chunk), "stdout");
      });
      child?.stderr?.on("data", (chunk) => {
        options.onOutput?.(String(chunk), "stderr");
      });
      child?.stdin?.end();
    });
}

function createGraphifyExecutionEnvironment(nodeRequire: DesktopRequire): NodeJS.ProcessEnv {
  const processModule = loadOptionalNodeModule<typeof import("process")>(nodeRequire, "process");
  const osModule = loadOptionalNodeModule<typeof import("os")>(nodeRequire, "os");
  const baseEnvironment = { ...(processModule?.env ?? {}) };
  const homeDirectory = typeof osModule?.homedir === "function" ? osModule.homedir() : undefined;
  const extraPathEntries = [
    homeDirectory === undefined ? "" : `${homeDirectory}/.local/bin`,
    homeDirectory === undefined ? "" : `${homeDirectory}/.bun/bin`,
    homeDirectory === undefined ? "" : `${homeDirectory}/.nvm/versions/node/v20.19.5/bin`,
    homeDirectory === undefined ? "" : `${homeDirectory}/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].filter((entry) => entry.length > 0);
  const existingPath = baseEnvironment.PATH ?? "";
  const mergedPathEntries = [...existingPath.split(":").filter((entry) => entry.length > 0), ...extraPathEntries];
  baseEnvironment.PATH = Array.from(new Set(mergedPathEntries)).join(":");

  return baseEnvironment;
}

function loadOptionalNodeModule<T>(nodeRequire: DesktopRequire, moduleName: string): T | null {
  try {
    return nodeRequire(moduleName) as T;
  } catch {
    return null;
  }
}

export function resolveVaultAbsolutePath(
  vaultBasePath: string,
  vaultRelativePath: string,
  joinPath: (basePath: string, relativePath: string) => string
): string {
  return joinPath(vaultBasePath, vaultRelativePath);
}

export function pathToFileUrl(absolutePath: string, nodeRequire: DesktopRequire | null = getDesktopRequire()): string {
  if (nodeRequire === null) {
    throw new Error("Desktop Node 런타임을 사용할 수 없습니다.");
  }

  const url = nodeRequire("url") as typeof import("url");

  return url.pathToFileURL(absolutePath).href;
}

function isDesktopRequire(value: unknown): value is DesktopRequire {
  return typeof value === "function";
}
