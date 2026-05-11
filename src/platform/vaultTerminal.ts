export type SupportedTerminalPlatform = "darwin" | "win32" | "linux";

export interface VaultTerminalLaunchCandidate {
  executable: string;
  args: string[];
  options: {
    cwd: string;
    windowsHide: boolean;
  };
}

export interface OpenVaultTerminalInput {
  platform: string;
  vaultBasePath: string;
  execFile: (
    executable: string,
    args: string[],
    options: VaultTerminalLaunchCandidate["options"],
    callback: (error: Error | null) => void
  ) => void;
}

export function createVaultTerminalLaunchCandidates(platform: string, vaultBasePath: string): VaultTerminalLaunchCandidate[] {
  const commonOptions = { cwd: vaultBasePath, windowsHide: false };

  if (platform === "darwin") {
    return [
      {
        executable: "open",
        args: ["-a", "Terminal", vaultBasePath],
        options: commonOptions
      }
    ];
  }

  if (platform === "win32") {
    return [
      {
        executable: "cmd.exe",
        args: ["/c", "start", "", "cmd.exe"],
        options: commonOptions
      }
    ];
  }

  if (platform === "linux") {
    return [
      {
        executable: "xdg-terminal-exec",
        args: [],
        options: commonOptions
      },
      {
        executable: "x-terminal-emulator",
        args: [],
        options: commonOptions
      },
      {
        executable: "gnome-terminal",
        args: ["--working-directory", vaultBasePath],
        options: commonOptions
      }
    ];
  }

  return [];
}

export async function openVaultTerminal(input: OpenVaultTerminalInput): Promise<void> {
  const candidates = createVaultTerminalLaunchCandidates(input.platform, input.vaultBasePath);

  if (candidates.length === 0) {
    throw new Error("현재 운영체제에서는 터미널 열기를 지원하지 않습니다.");
  }

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      await execFileOnce(input.execFile, candidate);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("터미널을 열 수 없습니다.");
}

function execFileOnce(
  execFile: OpenVaultTerminalInput["execFile"],
  candidate: VaultTerminalLaunchCandidate
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(candidate.executable, candidate.args, candidate.options, (error) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
