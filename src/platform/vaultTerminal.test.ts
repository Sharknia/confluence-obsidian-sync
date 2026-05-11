import { describe, expect, it, vi } from "vitest";
import { createVaultTerminalLaunchCandidates, openVaultTerminal } from "./vaultTerminal";

describe("createVaultTerminalLaunchCandidates", () => {
  it("uses Terminal.app on macOS with the vault path as the opened target", () => {
    expect(createVaultTerminalLaunchCandidates("darwin", "/Users/crobat/My Vault")).toEqual([
      {
        executable: "open",
        args: ["-a", "Terminal", "/Users/crobat/My Vault"],
        options: { cwd: "/Users/crobat/My Vault", windowsHide: false }
      }
    ]);
  });

  it("opens cmd.exe from the vault directory on Windows", () => {
    expect(createVaultTerminalLaunchCandidates("win32", "C:\\Users\\crobat\\My Vault")).toEqual([
      {
        executable: "cmd.exe",
        args: ["/c", "start", "", "cmd.exe"],
        options: { cwd: "C:\\Users\\crobat\\My Vault", windowsHide: false }
      }
    ]);
  });

  it("tries common Linux terminal launchers with the vault directory as cwd", () => {
    expect(createVaultTerminalLaunchCandidates("linux", "/home/crobat/My Vault")).toEqual([
      {
        executable: "xdg-terminal-exec",
        args: [],
        options: { cwd: "/home/crobat/My Vault", windowsHide: false }
      },
      {
        executable: "x-terminal-emulator",
        args: [],
        options: { cwd: "/home/crobat/My Vault", windowsHide: false }
      },
      {
        executable: "gnome-terminal",
        args: ["--working-directory", "/home/crobat/My Vault"],
        options: { cwd: "/home/crobat/My Vault", windowsHide: false }
      }
    ]);
  });
});

describe("openVaultTerminal", () => {
  it("executes the first successful terminal candidate", async () => {
    const execFile = vi.fn((_executable, _args, _options, callback: (error: Error | null) => void) => {
      callback(null);
    });

    await openVaultTerminal({
      platform: "darwin",
      vaultBasePath: "/Users/crobat/My Vault",
      execFile
    });

    expect(execFile).toHaveBeenCalledWith(
      "open",
      ["-a", "Terminal", "/Users/crobat/My Vault"],
      { cwd: "/Users/crobat/My Vault", windowsHide: false },
      expect.any(Function)
    );
  });

  it("tries the next Linux terminal when the first candidate is missing", async () => {
    const execFile = vi.fn((executable, _args, _options, callback: (error: Error | null) => void) => {
      callback(executable === "xdg-terminal-exec" ? Object.assign(new Error("missing"), { code: "ENOENT" }) : null);
    });

    await openVaultTerminal({
      platform: "linux",
      vaultBasePath: "/home/crobat/My Vault",
      execFile
    });

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[1]?.[0]).toBe("x-terminal-emulator");
  });

  it("reports unsupported platforms clearly", async () => {
    await expect(
      openVaultTerminal({
        platform: "freebsd",
        vaultBasePath: "/vault",
        execFile: vi.fn()
      })
    ).rejects.toThrow("현재 운영체제에서는 터미널 열기를 지원하지 않습니다.");
  });
});
