export class StorageGuardError extends Error {
  constructor(public readonly reason: string, public readonly vaultPath: string) {
    super(`파일 보호 검사로 작업을 차단했습니다: ${vaultPath}`);
  }
}

export interface StorageProgress {
  writtenFileCount: number;
  completedPaths: string[];
  failedPath: string | null;
  failedStage: string;
  outcomeUnknown: boolean;
  guardReason?: string;
}

export function storageFailureProgress(error: unknown, paths: string[], path: string | null, stage: string): StorageProgress {
  return {
    writtenFileCount: paths.length,
    completedPaths: [...paths],
    failedPath: path,
    failedStage: stage,
    outcomeUnknown: (stage === "write" || stage === "move") && !(error instanceof StorageGuardError),
    ...(error instanceof StorageGuardError ? { guardReason: error.reason } : {})
  };
}
