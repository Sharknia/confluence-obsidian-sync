import { describe, expect, it, vi } from "vitest";
import type { GraphifyAvailability, GraphifyOutputFileState, GraphifyRunOptions } from "./graphifyCli";
import { createCachedGraphifyAvailabilityChecker, openGraphifyOutputFile, runGraphifyForProject } from "./graphifyPanelActions";

describe("createCachedGraphifyAvailabilityChecker", () => {
  it("reuses cached availability within the TTL", async () => {
    let now = 1000;
    const checkAvailability = vi.fn((executable: string): Promise<GraphifyAvailability> => Promise.resolve({
      installed: true,
      executable,
      message: "graphify 0.3.24"
    }));
    const cached = createCachedGraphifyAvailabilityChecker({
      checkAvailability,
      now: () => now,
      ttlMilliseconds: 30_000
    });

    await cached("graphify");
    now = 2000;
    await cached("graphify");

    expect(checkAvailability).toHaveBeenCalledOnce();
  });

  it("misses cache when executable changes or TTL expires", async () => {
    let now = 1000;
    const checkAvailability = vi.fn((executable: string): Promise<GraphifyAvailability> => Promise.resolve({
      installed: true,
      executable,
      message: executable
    }));
    const cached = createCachedGraphifyAvailabilityChecker({
      checkAvailability,
      now: () => now,
      ttlMilliseconds: 30_000
    });

    await cached("graphify");
    await cached("/custom/graphify");
    now = 40_000;
    await cached("/custom/graphify");

    expect(checkAvailability).toHaveBeenCalledTimes(3);
  });
});

describe("runGraphifyForProject", () => {
  it("prevents duplicate graphify execution while a run is already active", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const runExecutable = vi.fn();

    await runGraphifyForProject({
      currentRunStatus: { kind: "running", message: "graphify 실행 중입니다..." },
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable,
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(runExecutable).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith({ kind: "running", message: "graphify 실행 중입니다..." });
  });

  it("keeps pure code update mode on the graphify CLI", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const runExecutable = vi.fn((executable: string, args: string[], options: GraphifyRunOptions) => {
      void executable;
      void args;
      void options;

      return Promise.resolve({ stdout: "", stderr: "" });
    });

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable,
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(runExecutable).toHaveBeenCalledWith("graphify", ["update", "confluence/기획 문서"], expect.objectContaining({
      cwd: "/vault",
      timeoutMilliseconds: 600_000,
      maxBufferBytes: 10 * 1024 * 1024
    }));
    expect(typeof runExecutable.mock.calls[0]?.[2].onOutput).toBe("function");
    expect(setStatus).toHaveBeenLastCalledWith({ kind: "success", message: "graphify 실행이 완료되었습니다." });
  });

  it("updates running status with live graphify output chunks", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const runExecutable = vi.fn((_executable: string, _args: string[], options: GraphifyRunOptions) => {
      options.onOutput?.("extracting markdown\n", "stdout");
      options.onOutput?.("building graph\n", "stderr");

      return Promise.resolve({ stdout: "", stderr: "" });
    });

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable,
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(setStatus).toHaveBeenCalledWith({
      kind: "running",
      message: "graphify 실행 중입니다...\n\nextracting markdown"
    });
    expect(setStatus).toHaveBeenCalledWith({
      kind: "running",
      message: "graphify 실행 중입니다...\n\nextracting markdown\nbuilding graph"
    });
  });

  it("fails after a successful process exit when graphify output files are missing", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const showNotice = vi.fn();
    const writeGraphifyRunLog = vi.fn(() => Promise.resolve());
    const runExecutable = vi.fn((_executable: string, _args: string[], options: GraphifyRunOptions) => {
      options.onOutput?.("Claude finished without files\n", "stdout");

      return Promise.resolve({ stdout: "", stderr: "" });
    });

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/폴더",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable,
      verifyGraphifyOutputFiles: () => Promise.resolve({ ok: false, missingFiles: ["GRAPH_REPORT.md", "graph.json", "graph.html"] }),
      writeGraphifyRunLog,
      setStatus,
      showNotice,
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: {
        kind: "agent-skill",
        runner: "claude",
        runnerExecutable: "claude"
      }
    });

    expect(writeGraphifyRunLog).toHaveBeenCalledWith(expect.stringContaining("Claude finished without files"));
    const lastStatusCall = setStatus.mock.calls.at(-1)?.[0];

    expect(lastStatusCall?.kind).toBe("failure");
    expect(lastStatusCall?.message).toContain("결과 파일이 생성되지 않았습니다: GRAPH_REPORT.md, graph.json, graph.html");
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining("graphify-out/latest-run.log"));
  });

  it("writes graphify run log when the process exits with failure", async () => {
    const writeGraphifyRunLog = vi.fn(() => Promise.resolve());

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable: vi.fn(() => Promise.reject(Object.assign(new Error("exit 1"), { stdout: "", stderr: "missing dependency" }))),
      writeGraphifyRunLog,
      setStatus: vi.fn(() => Promise.resolve()),
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(writeGraphifyRunLog).toHaveBeenCalledWith(expect.stringContaining("missing dependency"));
  });

  it("asks for confirmation before running Markdown graphify through an agent skill runner", async () => {
    const runExecutable = vi.fn(() => Promise.resolve({ stdout: "graphify done", stderr: "" }));
    const confirmGraphifyAgentRun = vi.fn(() => true);
    const copyGeneratedOutputToVaultRoot = vi.fn();

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/폴더",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: vi.fn(() => Promise.resolve(true)),
      runExecutable,
      copyGeneratedOutputToVaultRoot,
      setStatus: vi.fn(() => Promise.resolve()),
      showNotice: vi.fn(),
      confirmGraphifyAgentRun,
      graphifyRunMode: {
        kind: "agent-skill",
        runner: "claude",
        runnerExecutable: "claude"
      }
    });

    expect(confirmGraphifyAgentRun).toHaveBeenCalledWith(
      expect.stringContaining("LLM/subagent 실행, 파일 읽기/쓰기, 장시간 실행, 비용 발생 가능성이 있습니다")
    );
    expect(runExecutable).toHaveBeenCalledWith(
      "claude",
      ["-p", "--permission-mode", "bypassPermissions", "/graphify confluence/폴더"],
      expect.objectContaining({ cwd: "/vault" })
    );
    expect(copyGeneratedOutputToVaultRoot).not.toHaveBeenCalled();
  });

  it("does not start an agent run when confirmation is denied", async () => {
    const runExecutable = vi.fn();
    const setStatus = vi.fn(() => Promise.resolve());

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/폴더",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: vi.fn(() => Promise.resolve(true)),
      runExecutable,
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => false),
      graphifyRunMode: {
        kind: "agent-skill",
        runner: "claude",
        runnerExecutable: "claude"
      }
    });

    expect(runExecutable).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith({ kind: "idle", message: "graphify 실행을 취소했습니다." });
  });

  it("blocks unsafe or missing project folders before running graphify", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const runExecutable = vi.fn();

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "../secret",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable,
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(runExecutable).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith({
      kind: "failure",
      message: "graphify 실행 폴더가 vault 밖을 가리킬 수 없습니다."
    });
  });

  it("preserves stderr failure reason in panel status", async () => {
    const setStatus = vi.fn(() => Promise.resolve());
    const runExecutable = vi.fn(() => Promise.reject(Object.assign(new Error("exit 1"), { stdout: "", stderr: "missing dependency" })));

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.resolve(true),
      runExecutable,
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(setStatus).toHaveBeenLastCalledWith({
      kind: "failure",
      message: "graphify 실행 실패: missing dependency"
    });
  });

  it("stores project folder exists failures as panel status", async () => {
    const setStatus = vi.fn(() => Promise.resolve());

    await runGraphifyForProject({
      currentRunStatus: { kind: "idle", message: "" },
      projectFolderPath: "confluence/기획 문서",
      executable: "graphify",
      vaultBasePath: "/vault",
      timeoutMilliseconds: 600_000,
      projectFolderExists: () => Promise.reject(new Error("adapter failed")),
      runExecutable: vi.fn(),
      setStatus,
      showNotice: vi.fn(),
      confirmGraphifyAgentRun: vi.fn(() => true),
      graphifyRunMode: { kind: "cli-code-update" }
    });

    expect(setStatus).toHaveBeenCalledWith({
      kind: "failure",
      message: "graphify 실행 폴더를 확인할 수 없습니다: adapter failed"
    });
  });
});

describe("openGraphifyOutputFile", () => {
  it("opens only known graphify output paths", async () => {
    const outputFile: GraphifyOutputFileState = {
      label: "graph.html",
      path: "graphify-out/../secret.html",
      exists: true,
      openKind: "external"
    };
    const showNotice = vi.fn();

    await openGraphifyOutputFile({
      outputFile,
      openMarkdown: vi.fn(),
      openVaultPath: vi.fn(),
      openExternalUrl: vi.fn(() => true),
      toFileUrl: (path) => `file://${path}`,
      showNotice
    });

    expect(showNotice).toHaveBeenCalledWith("알 수 없는 graphify 결과 파일은 열 수 없습니다.");
  });

  it("shows a readable message when opening a known output file fails", async () => {
    const showNotice = vi.fn();

    await openGraphifyOutputFile({
      outputFile: {
        label: "GRAPH_REPORT.md",
        path: "graphify-out/GRAPH_REPORT.md",
        exists: true,
        openKind: "markdown"
      },
      openMarkdown: vi.fn(() => Promise.reject(new Error("cannot open report"))),
      openVaultPath: vi.fn(),
      openExternalUrl: vi.fn(() => true),
      toFileUrl: (path) => `file://${path}`,
      showNotice
    });

    expect(showNotice).toHaveBeenCalledWith("graphify 결과 파일을 열 수 없습니다: cannot open report");
  });

  it("shows a readable message when the browser refuses to open graph.html", async () => {
    const showNotice = vi.fn();

    await openGraphifyOutputFile({
      outputFile: {
        label: "graph.html",
        path: "graphify-out/graph.html",
        exists: true,
        openKind: "external"
      },
      openMarkdown: vi.fn(),
      openVaultPath: vi.fn(),
      openExternalUrl: vi.fn(() => false),
      toFileUrl: (path) => `file://${path}`,
      showNotice
    });

    expect(showNotice).toHaveBeenCalledWith("graphify 결과 파일을 열 수 없습니다: 브라우저가 graph.html 열기를 거부했습니다.");
  });

  it("opens external graphify output with noopener and noreferrer", async () => {
    const openExternalUrl = vi.fn(() => true);

    await openGraphifyOutputFile({
      outputFile: {
        label: "graph.html",
        path: "graphify-out/graph.html",
        exists: true,
        openKind: "external"
      },
      openMarkdown: vi.fn(),
      openVaultPath: vi.fn(),
      openExternalUrl,
      toFileUrl: (path) => `file://${path}`,
      showNotice: vi.fn()
    });

    expect(openExternalUrl).toHaveBeenCalledWith("file://graphify-out/graph.html", "_blank", "noopener,noreferrer");
  });
});
