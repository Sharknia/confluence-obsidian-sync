import { describe, expect, it } from "vitest";
import {
  FORCE_PULL_TREE_COMMAND_ID,
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID
} from "./commandIds";

describe("command IDs", () => {
  it("keeps stable command IDs for Obsidian command palette entries", () => {
    expect(OPEN_SYNC_PANEL_COMMAND_ID).toBe("open-sync-panel");
    expect(PULL_TREE_COMMAND_ID).toBe("pull-tree");
    expect(FORCE_PULL_TREE_COMMAND_ID).toBe("force-pull-tree");
    expect(PUSH_CURRENT_PAGE_COMMAND_ID).toBe("push-current-page");
  });
});
