export interface PluginPackageManifest {
  id: string;
  version: string;
}

export interface PluginPackagePlanAsset {
  fileName: string;
  sourcePath: string;
  targetPath: string;
}

export interface PluginPackagePlan {
  distDirectory: string;
  pluginDirectory: string;
  zipPath: string;
  assets: PluginPackagePlanAsset[];
}

export function buildPluginPackagePlan(input: {
  projectRoot: string;
  manifest: PluginPackageManifest;
}): PluginPackagePlan;
