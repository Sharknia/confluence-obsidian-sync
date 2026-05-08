import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createNodeExecutableRunner, getDesktopRequire, pathToFileUrl, resolveVaultAbsolutePath } from "./graphifyDesktopRuntime";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe("getDesktopRequire", () => {
  it("uses window.require when available", () => {
    const requireMock = vi.fn();

    expect(getDesktopRequire({ require: requireMock })).toBe(requireMock);
  });

  it("returns null when no require function is available", () => {
    expect(getDesktopRequire({})).toBeNull();
  });

  it("does not throw when called without window in a Node test environment", () => {
    expect(() => getDesktopRequire()).not.toThrow();
  });
});

describe("createNodeExecutableRunner", () => {
  it("maps execFile success to stdout and stderr", async () => {
    const execFile = vi.fn((_executable: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(null, "ok", "");
    });
    const runner = createNodeExecutableRunner((moduleName: string) => {
      expect(moduleName).toBe("child_process");

      return { execFile };
    });

    await expect(runner?.("graphify", ["--version"], { timeoutMilliseconds: 3_000 })).resolves.toEqual({
      stdout: "ok",
      stderr: ""
    });
    const execFileOptions = execFile.mock.calls[0]?.[2] as { env?: { PATH?: string } };

    expect(execFile).toHaveBeenCalledWith(
      "graphify",
      ["--version"],
      expect.objectContaining({ cwd: undefined, timeout: 3_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }),
      expect.any(Function)
    );
    expect(execFileOptions.env?.PATH).toContain("/opt/homebrew/bin");
  });

  it("adds common user binary directories to PATH for GUI-launched Obsidian", async () => {
    const execFile = vi.fn((_executable: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(null, "ok", "");
    });
    const runner = createNodeExecutableRunner((moduleName: string) => {
      if (moduleName === "child_process") {
        return { execFile };
      }

      if (moduleName === "os") {
        return { homedir: () => "/Users/crobat" };
      }

      if (moduleName === "process") {
        return { env: { PATH: "/usr/bin:/bin" } };
      }

      throw new Error(`unexpected module: ${moduleName}`);
    });

    await runner?.("graphify", ["--version"], { timeoutMilliseconds: 3_000 });
    const execFileOptions = execFile.mock.calls[0]?.[2] as { env?: { PATH?: string } };

    expect(execFile).toHaveBeenCalledWith(
      "graphify",
      ["--version"],
      expect.objectContaining({}),
      expect.any(Function)
    );
    expect(execFileOptions.env?.PATH).toContain("/Users/crobat/.local/bin");
  });

  it("adds common agent CLI directories to Desktop PATH", async () => {
    const execFile = vi.fn((_executable: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(null, "/Users/crobat/.bun/bin/codex\n", "");
    });
    const runner = createNodeExecutableRunner((moduleName: string) => {
      if (moduleName === "child_process") {
        return { execFile };
      }

      if (moduleName === "os") {
        return { homedir: () => "/Users/crobat" };
      }

      if (moduleName === "process") {
        return { env: { PATH: "/usr/bin:/bin" } };
      }

      throw new Error(`unexpected module: ${moduleName}`);
    });

    await runner?.("command", ["-v", "codex"], {
      cwd: "/vault",
      timeoutMilliseconds: 1_000,
      maxBufferBytes: 1_024
    });
    const execFileOptions = execFile.mock.calls[0]?.[2] as { env?: { PATH?: string } };

    expect(execFileOptions.env?.PATH).toContain("/Users/crobat/.bun/bin");
    expect(execFileOptions.env?.PATH).toContain("/Users/crobat/.nvm/versions/node/v20.19.5/bin");
  });

  it("attaches stdout and stderr when execFile fails", async () => {
    const execFile = vi.fn((_executable: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(new Error("exit 1"), "partial", "broken");
    });
    const runner = createNodeExecutableRunner(() => ({ execFile }));

    await expect(runner?.("graphify", ["."], { cwd: "/vault/confluence", timeoutMilliseconds: 120_000 })).rejects.toMatchObject({
      message: "exit 1",
      stdout: "partial",
      stderr: "broken"
    });
  });

  it("streams stdout and stderr chunks while the process is running", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const stdin = { end: vi.fn() };
    const execFile = vi.fn((_executable: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      queueMicrotask(() => {
        stdout.emit("data", "step 1\n");
        stderr.emit("data", "warning\n");
        callback(null, "done", "");
      });

      return { stdout, stderr, stdin };
    });
    const onOutput = vi.fn();
    const runner = createNodeExecutableRunner(() => ({ execFile }));

    await runner?.("graphify", ["update", "confluence"], {
      timeoutMilliseconds: 120_000,
      onOutput
    });

    expect(onOutput).toHaveBeenCalledWith("step 1\n", "stdout");
    expect(onOutput).toHaveBeenCalledWith("warning\n", "stderr");
    expect(stdin.end).toHaveBeenCalledOnce();
  });

  it("returns null when child_process cannot be loaded", () => {
    const runner = createNodeExecutableRunner(() => {
      throw new Error("module unavailable");
    });

    expect(runner).toBeNull();
  });

  it("normalizes execFile timeout errors", async () => {
    const execFile = vi.fn((_executable: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      callback(Object.assign(new Error("Command timed out"), { killed: true, signal: "SIGTERM" }), "", "");
    });
    const runner = createNodeExecutableRunner(() => ({ execFile }));

    await expect(runner?.("graphify", ["confluence"], { timeoutMilliseconds: 120_000 })).rejects.toMatchObject({
      code: "ETIMEDOUT"
    });
  });
});

describe("resolveVaultAbsolutePath", () => {
  it("joins the vault base path and safe relative path", () => {
    expect(resolveVaultAbsolutePath("/Users/crobat/Vault", "confluence/기획 문서", (base, relative) => `${base}/${relative}`)).toBe(
      "/Users/crobat/Vault/confluence/기획 문서"
    );
  });
});

describe("pathToFileUrl", () => {
  it("encodes spaces, hash marks, and Korean characters", () => {
    const nodeRequire = (moduleName: string) => {
      expect(moduleName).toBe("url");

      return {
        pathToFileURL: (absolutePath: string) => new URL(`file://${absolutePath.replaceAll(" ", "%20").replace("#", "%23")}`)
      };
    };

    expect(pathToFileUrl("/Users/crobat/Vault/기획 문서/graph #1.html", nodeRequire)).toBe(
      "file:///Users/crobat/Vault/%EA%B8%B0%ED%9A%8D%20%EB%AC%B8%EC%84%9C/graph%20%231.html"
    );
  });
});
