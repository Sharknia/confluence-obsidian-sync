import { describe, expect, it, vi } from "vitest";
import {
  buildGraphifyOutputFileStates,
  checkGraphifyAvailability,
  createGraphifyRunArguments,
  formatGraphifyFailureMessage,
  isKnownGraphifyOutputPath,
  resolveGraphifyExecutable,
  validateVaultRelativeProjectPath
} from "./graphifyCli";

describe("resolveGraphifyExecutable", () => {
  it("uses the default graphify command when no custom path is configured", () => {
    expect(resolveGraphifyExecutable("")).toBe("graphify");
  });

  it("uses the trimmed custom executable path when configured", () => {
    expect(resolveGraphifyExecutable("  /opt/homebrew/bin/graphify  ")).toBe("/opt/homebrew/bin/graphify");
  });
});

describe("checkGraphifyAvailability", () => {
  it("marks graphify as installed when the help command succeeds", async () => {
    const runExecutable = vi.fn().mockResolvedValue({ stdout: "graphify 0.3.24\n", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "graphify", runExecutable });

    expect(result).toEqual({
      installed: true,
      executable: "graphify",
      message: "graphify 0.3.24"
    });
    expect(runExecutable).toHaveBeenCalledWith("graphify", ["--version"], {
      cwd: undefined,
      timeoutMilliseconds: 3_000
    });
  });

  it("falls back to help when version is unsupported", async () => {
    const runExecutable = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("unknown option"), { stderr: "unknown option --version" }))
      .mockResolvedValueOnce({ stdout: "Usage: graphify <command>\n\nCommands:\n  update <path>", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "graphify", runExecutable });

    expect(result.installed).toBe(true);
    expect(result.message).toBe("graphify 실행 파일을 찾았습니다: graphify");
    expect(result.message).not.toContain("Usage:");
    expect(runExecutable).toHaveBeenNthCalledWith(2, "graphify", ["--help"], {
      cwd: undefined,
      timeoutMilliseconds: 3_000
    });
  });

  it("does not mark a non-graphify executable as installed after help fallback", async () => {
    const runExecutable = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("unknown option"), { stderr: "unknown option --version" }))
      .mockResolvedValueOnce({ stdout: "Usage: other-cli <folder>", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "other-cli", runExecutable });

    expect(result.installed).toBe(false);
    expect(result.message).toBe("graphify 실행 파일이 아닌 것 같습니다. 설정 경로를 확인하세요.");
  });

  it("does not mark a non-graphify executable as installed just because help succeeds", async () => {
    const runExecutable = vi.fn().mockResolvedValue({ stdout: "not graphify", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "python", runExecutable });

    expect(result.installed).toBe(false);
    expect(result.message).toBe("graphify 실행 파일이 아닌 것 같습니다. 설정 경로를 확인하세요.");
  });

  it("rejects wrapper output that only mentions graphify without being graphify", async () => {
    const runExecutable = vi.fn().mockResolvedValue({ stdout: "wrapper mentions graphify install", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "wrapper", runExecutable });

    expect(result.installed).toBe(false);
  });

  it("rejects misleading non-graphify install output", async () => {
    const runExecutable = vi.fn().mockResolvedValue({ stdout: "non-graphify install completed", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "wrapper", runExecutable });

    expect(result.installed).toBe(false);
  });

  it("rejects hyphenated not-a-graphify install output", async () => {
    const runExecutable = vi.fn().mockResolvedValue({ stdout: "not-a-graphify install completed", stderr: "" });

    const result = await checkGraphifyAvailability({ executable: "wrapper", runExecutable });

    expect(result.installed).toBe(false);
  });

  it("returns install guidance when executable is missing", async () => {
    const error = Object.assign(new Error("spawn graphify ENOENT"), { code: "ENOENT" });
    const runExecutable = vi.fn().mockRejectedValue(error);

    const result = await checkGraphifyAvailability({
      executable: "graphify",
      runExecutable
    });

    expect(result.installed).toBe(false);
    expect(result.message).toBe("graphify 실행 파일을 찾을 수 없습니다. 설치 후 설정에서 실행 경로를 지정하세요.");
    expect(runExecutable).toHaveBeenCalledOnce();
  });

  it("returns permission guidance when executable cannot be started", async () => {
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });

    const result = await checkGraphifyAvailability({
      executable: "/locked/graphify",
      runExecutable: vi.fn().mockRejectedValue(error)
    });

    expect(result.installed).toBe(false);
    expect(result.message).toBe("graphify 실행 권한이 없습니다. 실행 파일 권한과 설정 경로를 확인하세요.");
  });

  it("returns timeout guidance when help check times out", async () => {
    const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });

    const result = await checkGraphifyAvailability({
      executable: "graphify",
      runExecutable: vi.fn().mockRejectedValue(error)
    });

    expect(result.installed).toBe(false);
    expect(result.message).toBe("graphify 확인 시간이 초과되었습니다. 실행 경로가 올바른지 확인하세요.");
  });

  it("keeps non-zero help failures visible", async () => {
    const error = Object.assign(new Error("exit 1"), {
      stdout: "",
      stderr: "missing dependency"
    });

    const result = await checkGraphifyAvailability({
      executable: "graphify",
      runExecutable: vi.fn().mockRejectedValue(error)
    });

    expect(result.installed).toBe(false);
    expect(result.message).toBe("graphify를 실행할 수 없습니다: missing dependency");
  });
});

describe("createGraphifyRunArguments", () => {
  it("runs graphify against the current project folder from the vault root", () => {
    expect(createGraphifyRunArguments("confluence/기획 문서")).toEqual(["update", "confluence/기획 문서"]);
  });
});

describe("buildGraphifyOutputFileStates", () => {
  it("checks the expected graphify output files under the vault root graphify-out folder", async () => {
    const states = await buildGraphifyOutputFileStates({
      exists: (path) => Promise.resolve(path.endsWith("GRAPH_REPORT.md") || path.endsWith("graph.html"))
    });

    expect(states).toEqual([
      {
        label: "GRAPH_REPORT.md",
        path: "graphify-out/GRAPH_REPORT.md",
        exists: true,
        openKind: "markdown"
      },
      {
        label: "graph.json",
        path: "graphify-out/graph.json",
        exists: false,
        openKind: "external"
      },
      {
        label: "graph.html",
        path: "graphify-out/graph.html",
        exists: true,
        openKind: "external"
      }
    ]);
  });

  it("treats graphify output file existence check failures as missing files", async () => {
    const states = await buildGraphifyOutputFileStates({
      exists: () => Promise.reject(new Error("adapter failed"))
    });

    expect(states.every((state) => !state.exists)).toBe(true);
  });
});

describe("isKnownGraphifyOutputPath", () => {
  it("accepts only graphify output files owned by this integration", () => {
    expect(isKnownGraphifyOutputPath("graphify-out/GRAPH_REPORT.md")).toBe(true);
    expect(isKnownGraphifyOutputPath("graphify-out/graph.json")).toBe(true);
    expect(isKnownGraphifyOutputPath("graphify-out/graph.html")).toBe(true);
    expect(isKnownGraphifyOutputPath("graphify-out/../secret.html")).toBe(false);
    expect(isKnownGraphifyOutputPath("confluence/project/graphify-out/graph.html")).toBe(false);
  });
});

describe("validateVaultRelativeProjectPath", () => {
  it("accepts a normal vault-relative project path", () => {
    expect(validateVaultRelativeProjectPath("confluence/기획 문서")).toEqual({
      ok: true,
      path: "confluence/기획 문서"
    });
  });

  it("rejects absolute project paths", () => {
    expect(validateVaultRelativeProjectPath("/Users/crobat/vault/confluence")).toEqual({
      ok: false,
      message: "graphify 실행 폴더는 vault 내부 상대 경로여야 합니다."
    });
  });

  it("rejects parent directory traversal", () => {
    expect(validateVaultRelativeProjectPath("confluence/../secret")).toEqual({
      ok: false,
      message: "graphify 실행 폴더가 vault 밖을 가리킬 수 없습니다."
    });
  });
});

describe("formatGraphifyFailureMessage", () => {
  it("prefers stderr and truncates long output", () => {
    const message = formatGraphifyFailureMessage({
      error: new Error("command failed"),
      stdout: "ignored",
      stderr: "x".repeat(600)
    });

    expect(message).toContain("graphify 실행 실패:");
    expect(message.length).toBeLessThanOrEqual(360);
  });

  it("falls back to the Error message", () => {
    expect(
      formatGraphifyFailureMessage({
        error: new Error("permission denied"),
        stdout: "",
        stderr: ""
      })
    ).toBe("graphify 실행 실패: permission denied");
  });
});
