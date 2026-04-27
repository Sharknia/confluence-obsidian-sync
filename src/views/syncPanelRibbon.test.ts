import { describe, expect, it, vi } from "vitest";
import { registerSyncPanelRibbonIcon } from "./syncPanelRibbon";

describe("registerSyncPanelRibbonIcon", () => {
  it("registers a refresh icon that opens the Sync Panel", () => {
    const openSyncPanel = vi.fn();
    const addRibbonIcon = vi.fn();

    registerSyncPanelRibbonIcon({
      addRibbonIcon,
      openSyncPanel
    });

    expect(addRibbonIcon).toHaveBeenCalledWith(
      "refresh-cw",
      "Open Confluence Sync Panel",
      expect.any(Function)
    );

    const [, , callback] = addRibbonIcon.mock.calls[0] as [string, string, () => void];
    callback();

    expect(openSyncPanel).toHaveBeenCalledOnce();
  });
});
