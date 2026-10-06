export type CommandStatus = "success" | "unchanged" | "error" | "blocked" | "partial" | "unknown";

export interface CommandResult {
  status: CommandStatus;
  reason: string;
  message: string;
  counts?: Record<string, number>;
  confirmation?: {
    filePath?: string;
    pageId?: string;
    title?: string;
    remoteVersion?: number;
    nextVersion?: number;
    changedLocalFiles?: string[];
    backupRequired?: boolean;
  };
  remoteState?: "applied" | "not-applied" | "unknown";
  localUpdated?: boolean;
  versionNumber?: number;
  expectedVersion?: number;
  pageId?: string;
  filePath?: string;
  backupPath?: string | null;
  reportPath?: string | null;
  reportWritten?: boolean;
  completedPaths?: string[];
  failedPath?: string | null;
  failedStage?: string;
}

export function finishCommand(
  showNotice: (message: string) => void,
  status: CommandStatus,
  reason: string,
  message: string,
  details: Omit<CommandResult, "status" | "reason" | "message"> = {}
): CommandResult {
  showNotice(message);
  return { status, reason, message, ...details };
}

export function commandExitCode(result: CommandResult): number {
  switch (result.status) {
    case "success": case "unchanged": return 0;
    case "blocked": return 2;
    case "partial": case "unknown": return 3;
    case "error": return 1;
  }
}
