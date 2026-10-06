import { randomUUID } from "node:crypto";
import process from "node:process";
import { open, readFile, unlink, lstat } from "node:fs/promises";
import { createNodeVaultStorage } from "./nodeVaultStorage";

export class VaultLockedError extends Error {
  constructor() { super("vault 동기화가 이미 실행 중입니다. 남은 잠금은 실행 중인 작업이 없는지 확인한 뒤 .confluence-sync/operation.lock을 삭제하세요."); }
}

export async function withVaultOperationLock<T>(vaultPath: string, action: () => Promise<T>): Promise<T> {
  const storage = createNodeVaultStorage(vaultPath);
  await storage.mkdir(".confluence-sync");
  const path = await storage.resolvePath(".confluence-sync/operation.lock");
  const token = randomUUID();
  let handle;
  try { handle = await open(path, "wx", 0o600); }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new VaultLockedError();
    throw error;
  }
  const identity = await handle.stat();
  let written = false;
  // ponytail: vault 전체 잠금, 병렬 프로젝트 실행이 필요해지면 프로젝트별 잠금으로 좁힌다.
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }));
    written = true;
    await handle.close();
    return await action();
  } finally {
    await handle.close().catch(() => undefined);
    const stored = await readFile(path, "utf8").catch(() => "");
    const current = await lstat(path).catch(() => null);
    if (current?.ino === identity.ino && current.dev === identity.dev && (!written || stored.includes(token))) await unlink(path);
  }
}
