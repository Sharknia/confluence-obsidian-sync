import { describe, expect, it } from "vitest";
import { chooseSyncPanelLeaf } from "./syncPanelIntegration";

interface LeafMock {
  id: string;
}

describe("chooseSyncPanelLeaf", () => {
  it("reuses an existing Sync Panel leaf first", () => {
    const existingLeaf = { id: "existing" };
    const rightLeaf = { id: "right" };
    const newLeaf = { id: "new" };

    expect(
      chooseSyncPanelLeaf({
        existingLeaves: [existingLeaf],
        getRightLeaf: () => rightLeaf,
        getNewLeaf: () => newLeaf
      })
    ).toBe(existingLeaf);
  });

  it("uses the right sidebar leaf when no existing Sync Panel leaf exists", () => {
    const rightLeaf = { id: "right" };
    const newLeaf = { id: "new" };

    expect(
      chooseSyncPanelLeaf({
        existingLeaves: [],
        getRightLeaf: () => rightLeaf,
        getNewLeaf: () => newLeaf
      })
    ).toBe(rightLeaf);
  });

  it("falls back to a new workspace leaf when right sidebar leaf is unavailable", () => {
    const newLeaf = { id: "new" };

    expect(
      chooseSyncPanelLeaf<LeafMock>({
        existingLeaves: [],
        getRightLeaf: () => null,
        getNewLeaf: () => newLeaf
      })
    ).toBe(newLeaf);
  });
});
