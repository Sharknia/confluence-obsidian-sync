import { describe, expect, it, vi } from "vitest";
import { createGraphifyObsidianBridge } from "./graphifyObsidianBridge";
import type { GraphifyObsidianBridgeDependencies } from "./graphifyObsidianBridge";

function createDependencies(
  overrides: Partial<GraphifyObsidianBridgeDependencies> = {}
): GraphifyObsidianBridgeDependencies {
  return {
    isDesktop: true,
    getRunExecutable: () => vi.fn(),
    getVaultBasePath: () => "/vault",
    projectFolderExists: () => Promise.resolve(true),
    openMarkdown: vi.fn(),
    openVaultPath: vi.fn(),
    openExternalUrl: vi.fn(() => true),
    toFileUrl: (path) => `file://${path}`,
    verifyGraphifyOutputFiles: () => Promise.resolve({ ok: true }),
    writeGraphifyRunLog: vi.fn(() => Promise.resolve()),
    setStatus: vi.fn(),
    getRunStatus: () => ({ kind: "idle", message: "" }),
    showNotice: vi.fn(),
    confirmGraphifyAgentRun: vi.fn(() => true),
    checkExecutable: vi.fn(() => Promise.resolve(false)),
    homeRelativePathExists: vi.fn(() => Promise.resolve(false)),
    homeRelativeFileContains: vi.fn(() => Promise.resolve(false)),
    projectRelativePathExists: vi.fn(() => Promise.resolve(false)),
    projectRelativeFileContains: vi.fn(() => Promise.resolve(false)),
    ...overrides
  };
}

describe("createGraphifyObsidianBridge", () => {
  it("keeps Desktop graphify section visible while reporting runner absence through availability", async () => {
    const bridge = createGraphifyObsidianBridge({
      ...createDependencies({
      getRunExecutable: () => null,
      })
    });

    const availability = await bridge.createProvider().checkAvailability("graphify");

    expect(bridge.createProvider().isDesktop).toBe(true);
    expect(availability).toEqual({
      installed: false,
      executable: "graphify",
      message: "Desktop Node 런타임을 사용할 수 없어 graphify를 실행할 수 없습니다."
    });
  });

  it("stores FileSystemAdapter failures as graphify panel status", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const bridge = createGraphifyObsidianBridge({
      ...createDependencies({
      setStatus,
      getVaultBasePath: () => {
        throw new Error("현재 vault 어댑터에서 로컬 파일 시스템 경로를 확인할 수 없습니다.");
      }
      })
    });

    await bridge.runGraphify({
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      timeoutMilliseconds: 600_000,
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(setStatus).toHaveBeenCalledWith({
      kind: "failure",
      message: "현재 vault 어댑터에서 로컬 파일 시스템 경로를 확인할 수 없습니다."
    });
  });

  it("uses an internal lock to prevent rapid duplicate runs", async () => {
    let finishRun: (() => void) | undefined;
    const runExecutable = vi.fn(
      () =>
        new Promise<{ stdout: string; stderr: string }>((resolve) => {
          finishRun = () => resolve({ stdout: "", stderr: "" });
        })
    );
    const bridge = createGraphifyObsidianBridge({
      ...createDependencies({
      getRunExecutable: () => runExecutable,
      setStatus: vi.fn(() => Promise.resolve())
      })
    });

    const firstRun = bridge.runGraphify({
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      timeoutMilliseconds: 600_000,
      graphifyRunMode: { kind: "cli-code-update" }
    });
    await bridge.runGraphify({
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      timeoutMilliseconds: 600_000,
      graphifyRunMode: { kind: "cli-code-update" }
    });
    finishRun?.();
    await firstRun;

    expect(runExecutable).toHaveBeenCalledOnce();
  });

  it("shows the graphify section on Desktop even when the Node runner is unavailable", () => {
    const bridge = createGraphifyObsidianBridge({
      ...createDependencies({
      getRunExecutable: () => null,
      })
    });

    expect(bridge.createProvider().isDesktop).toBe(true);
  });

  it("routes output open failures to Notice without throwing", async () => {
    const showNotice = vi.fn();
    const bridge = createGraphifyObsidianBridge({
      ...createDependencies({
      showNotice,
      toFileUrl: () => {
        throw new Error("file url failed");
      }
      })
    });

    await bridge.openOutput({
      label: "graph.json",
      path: "graphify-out/graph.json",
      exists: true,
      openKind: "external"
    });

    expect(showNotice).toHaveBeenCalledWith("graphify 결과 파일을 열 수 없습니다: file url failed");
  });

  it("prefers Claude when graphify skill is installed for Claude", async () => {
    const bridge = createGraphifyObsidianBridge(
      createDependencies({
        checkExecutable: vi.fn((executable) => Promise.resolve(executable === "claude")),
        homeRelativePathExists: vi.fn((path) => Promise.resolve(path === ".claude/skills/graphify/SKILL.md")),
        projectRelativeFileContains: vi.fn(() => Promise.resolve(false))
      })
    );

    await expect(bridge.createProvider().checkAgentRunner()).resolves.toEqual({
      runner: "claude",
      runnerExecutable: "claude",
      skillInstalled: true,
      message: "Claude Code graphify skill 사용 가능"
    });
  });

  it("does not treat a generic Claude config file as a graphify skill install", async () => {
    const bridge = createGraphifyObsidianBridge(
      createDependencies({
        checkExecutable: vi.fn((executable) => Promise.resolve(executable === "claude")),
        homeRelativePathExists: vi.fn((path) => Promise.resolve(path === ".claude/CLAUDE.md")),
        homeRelativeFileContains: vi.fn(() => Promise.resolve(false))
      })
    );

    await expect(bridge.createProvider().checkAgentRunner()).resolves.toMatchObject({
      runner: null,
      skillInstalled: false
    });
  });

  it("accepts Claude CLAUDE.md only when it mentions graphify", async () => {
    const bridge = createGraphifyObsidianBridge(
      createDependencies({
        checkExecutable: vi.fn((executable) => Promise.resolve(executable === "claude")),
        homeRelativePathExists: vi.fn(() => Promise.resolve(false)),
        homeRelativeFileContains: vi.fn((path, text) => Promise.resolve(path === ".claude/CLAUDE.md" && text === "graphify"))
      })
    );

    await expect(bridge.createProvider().checkAgentRunner()).resolves.toEqual({
      runner: "claude",
      runnerExecutable: "claude",
      skillInstalled: true,
      message: "Claude Code graphify skill 사용 가능"
    });
  });

  it("accepts OpenCode AGENTS.md graphify install signal", async () => {
    const bridge = createGraphifyObsidianBridge(
      createDependencies({
        checkExecutable: vi.fn((executable) => Promise.resolve(executable === "opencode")),
        homeRelativePathExists: vi.fn(() => Promise.resolve(false)),
        projectRelativePathExists: vi.fn(() => Promise.resolve(false)),
        projectRelativeFileContains: vi.fn((path, text) => Promise.resolve(path === "AGENTS.md" && text === "graphify"))
      })
    );

    await expect(bridge.createProvider().checkAgentRunner()).resolves.toEqual({
      runner: "opencode",
      runnerExecutable: "opencode",
      skillInstalled: true,
      message: "OpenCode graphify skill 사용 가능"
    });
  });

  it("accepts OpenCode project graphify install signals", async () => {
    const bridge = createGraphifyObsidianBridge(
      createDependencies({
        checkExecutable: vi.fn((executable) => Promise.resolve(executable === "opencode")),
        homeRelativePathExists: vi.fn(() => Promise.resolve(false)),
        projectRelativePathExists: vi.fn((path) => Promise.resolve(path === ".opencode/plugins/graphify.js")),
        projectRelativeFileContains: vi.fn((path, text) => {
          if (path === "AGENTS.md" && text === "graphify") {
            return Promise.resolve(false);
          }

          if (path === "opencode.json" && text === ".opencode/plugins/graphify.js") {
            return Promise.resolve(true);
          }

          return Promise.resolve(false);
        })
      })
    );

    await expect(bridge.createProvider().checkAgentRunner()).resolves.toEqual({
      runner: "opencode",
      runnerExecutable: "opencode",
      skillInstalled: true,
      message: "OpenCode graphify skill 사용 가능"
    });
  });
});
