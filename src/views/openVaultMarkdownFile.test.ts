import { describe, expect, it, vi } from "vitest";
import { openVaultMarkdownFileFromObsidian, type VaultMarkdownFileOpenDependencies } from "./openVaultMarkdownFile";

function createDependencies(
  overrides: Partial<VaultMarkdownFileOpenDependencies<unknown>> = {}
): VaultMarkdownFileOpenDependencies<unknown> {
  return {
    getFileByPath: () => ({ path: "logs/latest.md" }),
    fileExists: () => Promise.resolve(true),
    openFileInNewTab: vi.fn(() => Promise.resolve()),
    openPathInNewTab: vi.fn(() => Promise.resolve()),
    showNotice: vi.fn(),
    wait: vi.fn(() => Promise.resolve()),
    ...overrides
  };
}

describe("openVaultMarkdownFileFromObsidian", () => {
  it("opens the report file in a new main tab when the vault cache has the file", async () => {
    const file = { path: "logs/latest.md" };
    const dependencies = createDependencies({
      getFileByPath: () => file
    });

    await openVaultMarkdownFileFromObsidian(dependencies, "logs/latest.md");

    expect(dependencies.openFileInNewTab).toHaveBeenCalledWith(file);
    expect(dependencies.openPathInNewTab).not.toHaveBeenCalled();
    expect(dependencies.showNotice).not.toHaveBeenCalled();
  });

  it("falls back to opening the path in a new main tab when the file exists but cache is stale", async () => {
    const dependencies = createDependencies({
      getFileByPath: () => null,
      fileExists: () => Promise.resolve(true)
    });

    await openVaultMarkdownFileFromObsidian(dependencies, "logs/latest.md");

    expect(dependencies.openFileInNewTab).not.toHaveBeenCalled();
    expect(dependencies.openPathInNewTab).toHaveBeenCalledWith("logs/latest.md");
    expect(dependencies.showNotice).not.toHaveBeenCalled();
  });
});
