export interface ChooseSyncPanelLeafInput<TLeaf> {
  existingLeaves: TLeaf[];
  getRightLeaf: () => TLeaf | null;
  getNewLeaf: () => TLeaf;
}

export function chooseSyncPanelLeaf<TLeaf>({
  existingLeaves,
  getRightLeaf,
  getNewLeaf
}: ChooseSyncPanelLeafInput<TLeaf>): TLeaf {
  const existingLeaf = existingLeaves[0];

  if (existingLeaf !== undefined) {
    return existingLeaf;
  }

  return getRightLeaf() ?? getNewLeaf();
}
