export type GraphifyAgentRunnerKind = "claude" | "opencode" | "codex";

export interface GraphifyAgentRunCommandInput {
  runner: GraphifyAgentRunnerKind;
  runnerExecutable: string;
  vaultBasePath: string;
  projectFolderPath: string;
}

export interface GraphifyAgentRunCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export type GraphifyAgentPathValidation = { ok: true; path: string } | { ok: false; message: string };

export function validateGraphifyAgentProjectPath(rawPath: string): GraphifyAgentPathValidation {
  const path = rawPath.trim().replace(/\\/gu, "/");

  if (path.length === 0 || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.split("/").includes("..")) {
    return { ok: false, message: "graphify 실행 폴더는 vault 내부 상대 경로여야 합니다." };
  }

  if (/[\p{Cc}`"'$;|<>]/u.test(path)) {
    return { ok: false, message: "graphify 실행 폴더 경로에 지원하지 않는 문자가 포함되어 있습니다." };
  }

  if (path.split("/").some((pathPart) => pathPart.startsWith("-"))) {
    return { ok: false, message: "graphify 실행 폴더 경로는 옵션처럼 보이는 이름을 포함할 수 없습니다." };
  }

  return { ok: true, path };
}

export function createGraphifySkillCommand(projectFolderPath: string): string {
  const validation = validateGraphifyAgentProjectPath(projectFolderPath);

  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return `/graphify ${validation.path}`;
}

export function getGraphifySkillInstallSignals(runner: GraphifyAgentRunnerKind): string[] {
  if (runner === "claude") {
    return ["home:.claude/skills/graphify/SKILL.md", "home:.claude/CLAUDE.md"];
  }

  if (runner === "opencode") {
    return [
      "home:.config/opencode/skills/graphify/SKILL.md",
      "project:AGENTS.md",
      "project:.opencode/plugins/graphify.js",
      "project:opencode.json"
    ];
  }

  return ["home:.agents/skills/graphify/SKILL.md", "project:AGENTS.md"];
}

export function buildGraphifyAgentRunCommand(input: GraphifyAgentRunCommandInput): GraphifyAgentRunCommand {
  const skillCommand = createGraphifySkillCommand(input.projectFolderPath);

  if (input.runner === "claude") {
    return {
      executable: input.runnerExecutable,
      args: ["-p", "--permission-mode", "bypassPermissions", skillCommand],
      cwd: input.vaultBasePath
    };
  }

  if (input.runner === "opencode") {
    return {
      executable: input.runnerExecutable,
      args: ["run", "--dir", input.vaultBasePath, skillCommand],
      cwd: input.vaultBasePath
    };
  }

  return {
    executable: input.runnerExecutable,
    args: ["exec", "--cd", input.vaultBasePath, "--sandbox", "workspace-write", "--full-auto", skillCommand],
    cwd: input.vaultBasePath
  };
}
