import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ConfluenceObsidianSyncPlugin graphify wiring", () => {
  it("registers the Sync Panel through the tested factory and graphify bridge", () => {
    const source = readFileSync("src/main.ts", "utf8");

    expect(source).toContain("createSyncPanelViewFactory");
    expect(source).toContain("getGraphifyProvider: () => this.createGraphifyProvider()");
    expect(source).toContain("onRunGraphify: (runMode) => this.runGraphifyForCurrentProject(runMode)");
    expect(source).toContain("onOpenGraphifyOutput: (outputFile) => this.openGraphifyOutput(outputFile)");
    expect(source).toContain("onCopyGraphifyMessage: (message) => this.copyGraphifyMessage(message)");
    expect(source).toContain("confirmGraphifyAgentRun: (message) => window.confirm(message)");
    expect(source).toContain("checkExecutable: (executable) => this.checkExecutableAvailable(executable)");
    expect(source).toContain("createGraphifyObsidianBridge");
  });
});
