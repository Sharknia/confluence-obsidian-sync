export interface VaultMarkdownFileOpenDependencies<TFile> {
  getFileByPath: (path: string) => TFile | null;
  fileExists: (path: string) => Promise<boolean>;
  openFileInNewTab: (file: TFile) => Promise<void>;
  openPathInNewTab: (path: string) => Promise<void>;
  showNotice: (message: string) => void;
  wait: (milliseconds: number) => Promise<void>;
}

export async function openVaultMarkdownFileFromObsidian<TFile>(
  dependencies: VaultMarkdownFileOpenDependencies<TFile>,
  path: string
): Promise<void> {
  for (let attemptCount = 0; attemptCount < 10; attemptCount += 1) {
    const file = dependencies.getFileByPath(path);

    if (file !== null) {
      await dependencies.openFileInNewTab(file);
      return;
    }

    await dependencies.wait(100);
  }

  if (await dependencies.fileExists(path)) {
    await dependencies.openPathInNewTab(path);
    return;
  }

  dependencies.showNotice(`Pull 리포트가 생성되었습니다: ${path}`);
}
