import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function readVersionFromJsonFile(path: string): string | undefined {
  const parsedJson = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };

  return typeof parsedJson.version === "string" ? parsedJson.version : undefined;
}

describe("plugin package version", () => {
  it("keeps package.json and manifest.json on the release version", () => {
    expect(readVersionFromJsonFile(join(projectRoot, "package.json"))).toBe("0.1.61");
    expect(readVersionFromJsonFile(join(projectRoot, "manifest.json"))).toBe("0.1.61");
  });
});
