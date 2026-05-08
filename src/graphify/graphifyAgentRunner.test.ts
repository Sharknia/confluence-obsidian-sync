import { describe, expect, it } from "vitest";
import {
  buildGraphifyAgentRunCommand,
  createGraphifySkillCommand,
  getGraphifySkillInstallSignals,
  validateGraphifyAgentProjectPath,
  type GraphifyAgentRunnerKind
} from "./graphifyAgentRunner";

describe("validateGraphifyAgentProjectPath", () => {
  it("allows normal Confluence Markdown folder paths", () => {
    expect(validateGraphifyAgentProjectPath("confluence/폴더/기획 문서").ok).toBe(true);
  });

  it("allows common Confluence title punctuation inside vault-relative paths", () => {
    expect(validateGraphifyAgentProjectPath("confluence/A&B + C#1, v2: 초안").ok).toBe(true);
    expect(createGraphifySkillCommand("confluence/A&B + C#1, v2: 초안")).toBe("/graphify confluence/A&B + C#1, v2: 초안");
  });

  it.each([
    "",
    "/abs/path",
    "../outside",
    "confluence/\nInjected",
    "confluence/`cmd`",
    "confluence/$HOME",
    "confluence/\"quoted\"",
    "confluence/;rm",
    "confluence/a|b",
    "confluence/<tag>",
    "confluence/--option"
  ])("rejects unsafe agent prompt path %s", (path) => {
    expect(validateGraphifyAgentProjectPath(path).ok).toBe(false);
  });
});

describe("createGraphifySkillCommand", () => {
  it("creates the document graphify skill command for a Confluence folder", () => {
    expect(createGraphifySkillCommand("confluence/폴더")).toBe("/graphify confluence/폴더");
  });
});

describe("getGraphifySkillInstallSignals", () => {
  it.each<[GraphifyAgentRunnerKind, string[]]>([
    ["claude", ["home:.claude/skills/graphify/SKILL.md", "home:.claude/CLAUDE.md"]],
    [
      "opencode",
      [
        "home:.config/opencode/skills/graphify/SKILL.md",
        "project:AGENTS.md",
        "project:.opencode/plugins/graphify.js",
        "project:opencode.json"
      ]
    ],
    ["codex", ["home:.agents/skills/graphify/SKILL.md", "project:AGENTS.md"]]
  ])("maps %s to its supported graphify skill signals", (runner, expectedSignals) => {
    expect(getGraphifySkillInstallSignals(runner)).toEqual(expectedSignals);
  });
});

describe("buildGraphifyAgentRunCommand", () => {
  it("builds a Claude graphify skill command", () => {
    expect(
      buildGraphifyAgentRunCommand({
        runner: "claude",
        runnerExecutable: "claude",
        vaultBasePath: "/vault",
        projectFolderPath: "confluence/폴더"
      })
    ).toEqual({
      executable: "claude",
      args: ["-p", "--permission-mode", "bypassPermissions", "/graphify confluence/폴더"],
      cwd: "/vault"
    });
  });

  it("builds an opencode graphify skill command", () => {
    expect(
      buildGraphifyAgentRunCommand({
        runner: "opencode",
        runnerExecutable: "opencode",
        vaultBasePath: "/vault",
        projectFolderPath: "confluence/폴더"
      })
    ).toEqual({
      executable: "opencode",
      args: ["run", "--dir", "/vault", "/graphify confluence/폴더"],
      cwd: "/vault"
    });
  });

  it("builds a Codex fallback command using supported exec flags", () => {
    expect(
      buildGraphifyAgentRunCommand({
        runner: "codex",
        runnerExecutable: "codex",
        vaultBasePath: "/vault",
        projectFolderPath: "confluence/폴더"
      })
    ).toEqual({
      executable: "codex",
      args: ["exec", "--cd", "/vault", "--sandbox", "workspace-write", "--full-auto", "/graphify confluence/폴더"],
      cwd: "/vault"
    });
  });
});
