import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile, link, unlink, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectStorageAdapter } from "../projects/projectStorage";
import { StorageGuardError } from "../projects/storageFailure";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function createNodeVaultStorage(vaultPath: string): ProjectStorageAdapter & {
  resolvePath(path: string): Promise<string>;
} {
  const vaultRoot = realpath(vaultPath);
  const snapshots = new Map<string, string | null>();

  async function resolvePath(path: string): Promise<string> {
    if (isAbsolute(path) || path.includes("\\") || path.split("/").includes("..")) {
      throw new StorageGuardError("unsafe-path", path);
    }
    const root = await vaultRoot;
    const fullPath = resolve(root, path);
    const within = relative(root, fullPath);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      throw new StorageGuardError("unsafe-path", path);
    }
    let current = root;
    for (const segment of within.split(sep).filter(Boolean)) {
      current = join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new StorageGuardError("unsafe-path", path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    try {
      const canonical = await realpath(fullPath);
      const inside = relative(root, canonical);
      if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new StorageGuardError("unsafe-path", path);
      return canonical;
    } catch (error) {
      if (!isMissing(error)) throw error;
      return fullPath;
    }
  }

  async function currentContent(path: string): Promise<string | null> {
    try { return await readFile(await resolvePath(path), "utf8"); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  }

  async function observe(path: string): Promise<void> {
    if (!snapshots.has(path)) snapshots.set(path, await currentContent(path));
  }

  async function assertUnchanged(path: string): Promise<void> {
    await observe(path);
    if (await currentContent(path) !== snapshots.get(path)) throw new StorageGuardError("local-changed", path);
  }

  return {
    resolvePath,
    assertUnchanged,
    async exists(path) {
      try {
        const stat = await lstat(await resolvePath(path));
        if (stat.isFile()) await observe(path);
        return true;
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (!snapshots.has(path)) snapshots.set(path, null);
        return false;
      }
    },
    async mkdir(path) { await mkdir(await resolvePath(path), { recursive: true }); },
    async read(path) {
      const value = await readFile(await resolvePath(path), "utf8");
      if (!snapshots.has(path)) snapshots.set(path, value);
      return value;
    },
    async write(path, data) {
      await assertUnchanged(path);
      const target = await resolvePath(path);
      const temporary = join(dirname(target), `.confluence-sync-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, data, { flag: "wx" });
        await assertUnchanged(path);
        if (snapshots.get(path) === null) await link(temporary, await resolvePath(path));
        else await rename(temporary, await resolvePath(path));
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new StorageGuardError("path-conflict", path);
        throw error;
      } finally {
        await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error; });
      }
      snapshots.set(path, data);
    },
    async list(path) {
      const entries = await readdir(await resolvePath(path), { withFileTypes: true });
      if (entries.some((entry) => entry.isSymbolicLink())) throw new StorageGuardError("unsafe-path", path);
      return {
        files: entries.filter((entry) => entry.isFile()).map((entry) => `${path}/${entry.name}`),
        folders: entries.filter((entry) => entry.isDirectory()).map((entry) => `${path}/${entry.name}`)
      };
    },
    async rename(from, to) {
      await assertUnchanged(from);
      // 배타적인 대상 생성으로 안전 삭제 경로의 뒤늦은 충돌도 보호한다.
      await link(await resolvePath(from), await resolvePath(to));
      await unlink(await resolvePath(from));
      snapshots.set(to, snapshots.get(from) ?? null);
      snapshots.set(from, null);
    }
  };
}
