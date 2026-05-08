import {
  checkGraphifyAvailability,
  type GraphifyAvailability,
  type GraphifyExecutableRunner,
  type GraphifyOutputFileState,
  type GraphifyRunStatus
} from "./graphifyCli";
import type { GraphifyAgentRunnerKind } from "./graphifyAgentRunner";
import {
  createCachedGraphifyAvailabilityChecker,
  openGraphifyOutputFile,
  runGraphifyForProject,
  type GraphifyRunMode
} from "./graphifyPanelActions";

export interface GraphifyAgentRunnerState {
  runner: GraphifyAgentRunnerKind | null;
  runnerExecutable: string;
  skillInstalled: boolean;
  message: string;
}

export interface GraphifyObsidianBridgeDependencies {
  isDesktop: boolean;
  getRunExecutable: () => GraphifyExecutableRunner | null;
  getVaultBasePath: () => string;
  projectFolderExists: (path: string) => Promise<boolean>;
  checkExecutable: (executable: string) => Promise<boolean>;
  homeRelativePathExists: (path: string) => Promise<boolean>;
  homeRelativeFileContains: (path: string, text: string) => Promise<boolean>;
  projectRelativePathExists: (path: string) => Promise<boolean>;
  projectRelativeFileContains: (path: string, text: string) => Promise<boolean>;
  openMarkdown: (path: string) => Promise<void>;
  openVaultPath: (path: string) => Promise<void>;
  openExternalUrl: (url: string, target: string, features: string) => boolean;
  toFileUrl: (path: string) => string;
  copyGeneratedOutputToVaultRoot?: (projectFolderPath: string) => Promise<void>;
  verifyGraphifyOutputFiles?: () => Promise<{ ok: true } | { ok: false; missingFiles: string[] }>;
  writeGraphifyRunLog?: (log: string) => Promise<void>;
  setStatus: (status: GraphifyRunStatus) => Promise<void>;
  getRunStatus: () => GraphifyRunStatus;
  showNotice: (message: string) => void;
  confirmGraphifyAgentRun: (message: string) => boolean;
}

export function createGraphifyObsidianBridge(dependencies: GraphifyObsidianBridgeDependencies): {
  createProvider: () => {
    isDesktop: boolean;
    getRunStatus: () => GraphifyRunStatus;
    checkAvailability: (executable: string) => Promise<GraphifyAvailability>;
    checkAgentRunner: () => Promise<GraphifyAgentRunnerState>;
  };
  runGraphify: (input: { projectFolderPath: string; executable: string; timeoutMilliseconds: number; graphifyRunMode: GraphifyRunMode }) => Promise<void>;
  openOutput: (outputFile: GraphifyOutputFileState) => Promise<void>;
} {
  let runInFlight = false;
  const availabilityChecker = createCachedGraphifyAvailabilityChecker({
    checkAvailability: async (executable) => {
      const runExecutable = dependencies.getRunExecutable();

      if (runExecutable === null) {
        return {
          installed: false,
          executable,
          message: "Desktop Node 런타임을 사용할 수 없어 graphify를 실행할 수 없습니다."
        };
      }

      return checkGraphifyAvailability({ executable, runExecutable });
    },
    now: () => Date.now(),
    ttlMilliseconds: 30_000
  });

  return {
    createProvider: () => ({
      isDesktop: dependencies.isDesktop,
      getRunStatus: dependencies.getRunStatus,
      checkAvailability: (executable) => availabilityChecker(executable),
      checkAgentRunner: () => checkGraphifyAgentRunner(dependencies)
    }),
    runGraphify: async ({ projectFolderPath, executable, timeoutMilliseconds, graphifyRunMode }) => {
      if (runInFlight) {
        await dependencies.setStatus({ kind: "running", message: "graphify 실행 중입니다..." });
        return;
      }

      runInFlight = true;
      void dependencies.setStatus({ kind: "running", message: "graphify 실행 중입니다..." });

      try {
        const runExecutable = dependencies.getRunExecutable();

        if (!dependencies.isDesktop || runExecutable === null) {
          await dependencies.setStatus({ kind: "failure", message: "graphify 실행은 Desktop Obsidian에서만 지원합니다." });
          return;
        }

        let vaultBasePath: string;

        try {
          vaultBasePath = dependencies.getVaultBasePath();
        } catch (error) {
          await dependencies.setStatus({
            kind: "failure",
            message: error instanceof Error ? error.message : "vault 경로를 확인할 수 없습니다."
          });
          return;
        }

        await runGraphifyForProject({
          currentRunStatus: { kind: "idle", message: "" },
          projectFolderPath,
          executable,
          vaultBasePath,
          timeoutMilliseconds,
          projectFolderExists: dependencies.projectFolderExists,
          runExecutable,
          copyGeneratedOutputToVaultRoot: dependencies.copyGeneratedOutputToVaultRoot,
          verifyGraphifyOutputFiles: dependencies.verifyGraphifyOutputFiles,
          writeGraphifyRunLog: dependencies.writeGraphifyRunLog,
          setStatus: dependencies.setStatus,
          showNotice: dependencies.showNotice,
          confirmGraphifyAgentRun: dependencies.confirmGraphifyAgentRun,
          graphifyRunMode
        });
      } finally {
        runInFlight = false;
      }
    },
    openOutput: (outputFile) =>
      openGraphifyOutputFile({
        outputFile,
        openMarkdown: dependencies.openMarkdown,
        openVaultPath: dependencies.openVaultPath,
        openExternalUrl: dependencies.openExternalUrl,
        toFileUrl: dependencies.toFileUrl,
        showNotice: dependencies.showNotice
      })
  };
}

async function checkGraphifyAgentRunner(
  dependencies: Pick<
    GraphifyObsidianBridgeDependencies,
    "checkExecutable" | "homeRelativePathExists" | "homeRelativeFileContains" | "projectRelativePathExists" | "projectRelativeFileContains"
  >
): Promise<GraphifyAgentRunnerState> {
  if (await isClaudeGraphifyReady(dependencies)) {
    return {
      runner: "claude",
      runnerExecutable: "claude",
      skillInstalled: true,
      message: "Claude Code graphify skill 사용 가능"
    };
  }

  if (await isOpenCodeGraphifyReady(dependencies)) {
    return {
      runner: "opencode",
      runnerExecutable: "opencode",
      skillInstalled: true,
      message: "OpenCode graphify skill 사용 가능"
    };
  }

  if (await isCodexGraphifyReady(dependencies)) {
    return {
      runner: "codex",
      runnerExecutable: "codex",
      skillInstalled: true,
      message: "Codex graphify skill 사용 가능"
    };
  }

  return {
    runner: null,
    runnerExecutable: "",
    skillInstalled: false,
    message: "Markdown graphify 실행에는 Claude Code, OpenCode, 또는 Codex graphify skill이 필요합니다."
  };
}

async function isClaudeGraphifyReady(
  dependencies: Pick<GraphifyObsidianBridgeDependencies, "checkExecutable" | "homeRelativePathExists" | "homeRelativeFileContains">
): Promise<boolean> {
  return (
    (await dependencies.checkExecutable("claude")) &&
    ((await dependencies.homeRelativePathExists(".claude/skills/graphify/SKILL.md")) ||
      (await dependencies.homeRelativeFileContains(".claude/CLAUDE.md", "graphify")))
  );
}

async function isOpenCodeGraphifyReady(
  dependencies: Pick<
    GraphifyObsidianBridgeDependencies,
    "checkExecutable" | "homeRelativePathExists" | "projectRelativePathExists" | "projectRelativeFileContains"
  >
): Promise<boolean> {
  return (
    (await dependencies.checkExecutable("opencode")) &&
    ((await dependencies.homeRelativePathExists(".config/opencode/skills/graphify/SKILL.md")) ||
      (await dependencies.projectRelativeFileContains("AGENTS.md", "graphify")) ||
      ((await dependencies.projectRelativePathExists(".opencode/plugins/graphify.js")) &&
        (await dependencies.projectRelativeFileContains("opencode.json", ".opencode/plugins/graphify.js"))))
  );
}

async function isCodexGraphifyReady(
  dependencies: Pick<
    GraphifyObsidianBridgeDependencies,
    "checkExecutable" | "homeRelativePathExists" | "projectRelativeFileContains"
  >
): Promise<boolean> {
  return (
    (await dependencies.checkExecutable("codex")) &&
    ((await dependencies.homeRelativePathExists(".agents/skills/graphify/SKILL.md")) ||
      (await dependencies.projectRelativeFileContains("AGENTS.md", "graphify")))
  );
}
