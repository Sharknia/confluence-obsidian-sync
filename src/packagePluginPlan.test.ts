import { describe, expect, it } from "vitest";
import { buildPluginPackagePlan } from "../scripts/package-plugin.mjs";

describe("buildPluginPackagePlan", () => {
  it("builds a manual install folder and zip name from the manifest", () => {
    const plan = buildPluginPackagePlan({
      projectRoot: "/repo",
      manifest: {
        id: "confluence-obsidian-sync",
        version: "0.1.0"
      }
    });

    expect(plan.pluginDirectory).toBe("/repo/dist/confluence-obsidian-sync");
    expect(plan.zipPath).toBe("/repo/dist/confluence-obsidian-sync-0.1.0.zip");
    expect(plan.assets.map((asset) => asset.fileName)).toEqual(["main.js", "manifest.json", "styles.css"]);
  });
});
