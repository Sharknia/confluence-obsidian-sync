import { FileSystemAdapter, Notice, Platform, Plugin, requestUrl, type TFile } from "obsidian";
import {
  FORCE_PULL_TREE_COMMAND_ID,
  OPEN_VAULT_TERMINAL_COMMAND_ID,
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_CURRENT_PAGE_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID,
  UPDATE_PLUGIN_COMMAND_ID
} from "./commands/commandIds";
import { runPullCurrentPageCommand } from "./commands/pullCurrentPageCommand";
import { runPullTreeCommand, type PullTreeProjectEnsurerResult } from "./commands/pullTreeCommand";
import { runPushCurrentPageCommand } from "./commands/pushCurrentPageCommand";
import { createObsidianRequestTransport } from "./confluence/obsidianRequestTransport";
import {
  resolveGraphifyExecutable,
  type GraphifyAvailability,
  type GraphifyOutputFileState,
  type GraphifyRunStatus
} from "./graphify/graphifyCli";
import type { GraphifyRunMode } from "./graphify/graphifyPanelActions";
import {
  createNodeExecutableRunner,
  getDesktopRequire,
  pathToFileUrl,
  resolveVaultAbsolutePath,
  type DesktopRequire
} from "./graphify/graphifyDesktopRuntime";
import { createGraphifyObsidianBridge } from "./graphify/graphifyObsidianBridge";
import { buildPullReportPath } from "./projects/pullReport";
import { createProjectFromRootUrl } from "./projects/createProjectFromRootUrl";
import type { ProjectStorageAdapter } from "./projects/projectStorage";
import {
  DEFAULT_PLUGIN_ID,
  DEFAULT_PLUGIN_RELEASE_REPOSITORY,
  updatePluginFromLatestRelease
} from "./platform/pluginUpdater";
import { openVaultTerminal as openVaultTerminalWithRuntime } from "./platform/vaultTerminal";
import { ConfluenceSyncSettingTab } from "./settings/ConfluenceSyncSettingTab";
import {
  DEFAULT_CONFLUENCE_SYNC_SETTINGS,
  loadConfluenceSyncSettings,
  type ConfluenceSyncSettings
} from "./settings/defaultSettings";
import { chooseSyncPanelLeaf } from "./views/syncPanelIntegration";
import { registerSyncPanelRibbonIcon } from "./views/syncPanelRibbon";
import { createSyncPanelViewFactory } from "./views/registerSyncPanelView";
import { SYNC_PANEL_VIEW_TYPE, SyncPanelView } from "./views/syncPanelView";
import { openVaultMarkdownFileFromObsidian } from "./views/openVaultMarkdownFile";

export default class ConfluenceObsidianSyncPlugin extends Plugin {
  settings: ConfluenceSyncSettings = { ...DEFAULT_CONFLUENCE_SYNC_SETTINGS };
  private graphifyRunStatus: GraphifyRunStatus = { kind: "idle", message: "" };
  private graphifyBridge: ReturnType<typeof createGraphifyObsidianBridge> | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ConfluenceSyncSettingTab(this));
    this.registerView(
      SYNC_PANEL_VIEW_TYPE,
      createSyncPanelViewFactory({
        getSettings: () => this.settings,
        getStorage: () => createVaultStorageAdapter(this),
        getGraphifyProvider: () => this.createGraphifyProvider(),
        createView: (leaf, dependencies) => new SyncPanelView(leaf, dependencies),
        onPullTree: () => this.runPullTree(),
        onForcePullTree: () => this.runForcePullTree(),
        onPullCurrentPage: () => this.pullCurrentPage(),
        onPushCurrentPage: () => this.pushCurrentPage(),
        onOpenRootLink: () => this.openCurrentProjectRootLink(),
        onOpenLatestReport: () => this.openCurrentProjectLatestReport(),
        onOpenVaultTerminal: () => this.openVaultTerminal(),
        onUpdatePlugin: () => this.updatePluginFromRelease(),
        onRunGraphify: (runMode) => this.runGraphifyForCurrentProject(runMode),
        onOpenGraphifyOutput: (outputFile) => this.openGraphifyOutput(outputFile),
        onCopyGraphifyMessage: (message) => this.copyGraphifyMessage(message)
      })
    );
    registerSyncPanelRibbonIcon({
      addRibbonIcon: (icon, title, callback) => this.addRibbonIcon(icon, title, callback),
      openSyncPanel: () => this.openSyncPanel()
    });
    this.registerCommands();
  }

  async loadSettings(): Promise<void> {
    this.settings = await loadConfluenceSyncSettings(() => this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private registerCommands(): void {
    this.addCommand({
      id: OPEN_SYNC_PANEL_COMMAND_ID,
      name: "Open Sync Panel",
      callback: () => {
        void this.openSyncPanel();
      }
    });

    this.addCommand({
      id: PULL_TREE_COMMAND_ID,
      name: "Pull Tree",
      callback: () => {
        void this.runPullTree();
      }
    });

    this.addCommand({
      id: FORCE_PULL_TREE_COMMAND_ID,
      name: "Force Pull Tree",
      callback: () => {
        void this.runForcePullTree();
      }
    });

    this.addCommand({
      id: PULL_CURRENT_PAGE_COMMAND_ID,
      name: "Pull Current Page",
      callback: () => {
        void this.pullCurrentPage();
      }
    });

    this.addCommand({
      id: PUSH_CURRENT_PAGE_COMMAND_ID,
      name: "Push Current Page",
      callback: () => {
        void this.pushCurrentPage();
      }
    });

    this.addCommand({
      id: OPEN_VAULT_TERMINAL_COMMAND_ID,
      name: "Open Vault Terminal",
      callback: () => {
        void this.openVaultTerminal();
      }
    });

    this.addCommand({
      id: UPDATE_PLUGIN_COMMAND_ID,
      name: "Update Plugin",
      callback: () => {
        void this.updatePluginFromRelease();
      }
    });
  }

  private async openSyncPanel(): Promise<void> {
    const leaf = chooseSyncPanelLeaf({
      existingLeaves: this.app.workspace.getLeavesOfType(SYNC_PANEL_VIEW_TYPE),
      getRightLeaf: () => this.app.workspace.getRightLeaf(false),
      getNewLeaf: () => this.app.workspace.getLeaf(true)
    });

    await leaf.setViewState({
      type: SYNC_PANEL_VIEW_TYPE,
      active: true
    });

    await this.app.workspace.revealLeaf(leaf);
  }

  private async refreshSyncPanelViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(SYNC_PANEL_VIEW_TYPE)) {
      const view = leaf.view;

      if (view instanceof SyncPanelView) {
        await view.refresh();
      }
    }
  }

  private async runPullTree(): Promise<void> {
    await runPullTreeCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      ensureCurrentProject: () => this.ensureCurrentProject(),
      showNotice: (message) => new Notice(message),
      openReport: (path) => openVaultMarkdownFile(this, path)
    });

    await this.refreshSyncPanelViews();
  }

  private async runForcePullTree(): Promise<void> {
    await runPullTreeCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      ensureCurrentProject: () => this.ensureCurrentProject(),
      mode: "force",
      confirmForcePull: (message) => window.confirm(message),
      showNotice: (message) => new Notice(message),
      openReport: (path) => openVaultMarkdownFile(this, path)
    });

    await this.refreshSyncPanelViews();
  }

  private async ensureCurrentProject(): Promise<PullTreeProjectEnsurerResult> {
    if (this.settings.currentProject !== null) {
      return {
        ok: true,
        currentProject: this.settings.currentProject
      };
    }

    let result: Awaited<ReturnType<typeof createProjectFromRootUrl>>;

    try {
      result = await createProjectFromRootUrl({
        settings: this.settings,
        rawRootUrl: this.settings.defaultRootContentUrl,
        transport: createObsidianRequestTransport,
        storage: createVaultStorageAdapter(this),
        now: () => new Date()
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Confluence 프로젝트를 생성할 수 없습니다."
      };
    }

    if (!result.ok) {
      return result;
    }

    const previousCurrentProject = this.settings.currentProject;
    this.settings.currentProject = result.currentProject;

    try {
      await this.saveSettings();
    } catch (error) {
      this.settings.currentProject = previousCurrentProject;

      return {
        ok: false,
        message: error instanceof Error ? error.message : "프로젝트 설정을 저장할 수 없습니다."
      };
    }

    return {
      ok: true,
      currentProject: result.currentProject
    };
  }

  private async pullCurrentPage(): Promise<void> {
    await runPullCurrentPageCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      getActiveMarkdownFile: () => {
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile === null || activeFile.extension !== "md") {
          return null;
        }

        return { path: activeFile.path };
      },
      confirmOverwriteLocalChanges: (message) => window.confirm(message),
      showNotice: (message) => new Notice(message)
    });

    await this.refreshSyncPanelViews();
  }

  private async pushCurrentPage(): Promise<void> {
    await runPushCurrentPageCommand({
      settings: this.settings,
      storage: createVaultStorageAdapter(this),
      getActiveMarkdownFile: () => {
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile === null || activeFile.extension !== "md") {
          return null;
        }

        return { path: activeFile.path };
      },
      confirmPush: (message) => window.confirm(message),
      showNotice: (message) => new Notice(message)
    });

    await this.refreshSyncPanelViews();
  }

  private openCurrentProjectRootLink(): void {
    const rootUrl = this.settings.currentProject?.rootUrl;

    if (rootUrl === undefined || rootUrl.length === 0) {
      new Notice("열 수 있는 루트 콘텐츠 링크가 없습니다.");
      return;
    }

    window.open(rootUrl);
  }

  private async openCurrentProjectLatestReport(): Promise<void> {
    const currentProject = this.settings.currentProject;

    if (currentProject === null) {
      new Notice("현재 프로젝트가 없어 Pull 리포트를 열 수 없습니다.");
      return;
    }

    await openVaultMarkdownFile(this, buildPullReportPath(currentProject.localFolderPath));
  }

  private async openVaultTerminal(): Promise<void> {
    const nodeRequire = getDesktopRequire();

    if (!Platform.isDesktop || nodeRequire === null) {
      new Notice("터미널 열기는 Desktop Obsidian에서만 지원합니다.");
      return;
    }

    try {
      const childProcessModule = loadRequiredDesktopModule<typeof import("child_process")>(nodeRequire, "child_process");
      const processModule = loadRequiredDesktopModule<typeof import("process")>(nodeRequire, "process");

      await openVaultTerminalWithRuntime({
        platform: processModule.platform,
        vaultBasePath: this.getVaultBasePath(),
        execFile: childProcessModule.execFile
      });
      new Notice("vault 루트에서 터미널을 열었습니다.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "터미널을 열 수 없습니다.");
    }
  }

  private async updatePluginFromRelease(): Promise<void> {
    const nodeRequire = getDesktopRequire();

    if (!Platform.isDesktop || nodeRequire === null) {
      new Notice("플러그인 업데이트는 Desktop Obsidian에서만 지원합니다.");
      return;
    }

    new Notice("플러그인 업데이트를 확인합니다...");

    try {
      const fsModule = loadRequiredDesktopModule<typeof import("fs")>(nodeRequire, "fs");
      const osModule = loadRequiredDesktopModule<typeof import("os")>(nodeRequire, "os");
      const pathModule = loadRequiredDesktopModule<typeof import("path")>(nodeRequire, "path");
      const temporaryDirectoryPath = pathModule.join(osModule.tmpdir(), `${DEFAULT_PLUGIN_ID}-update-${Date.now()}`);
      const pluginDirectoryPath = pathModule.join(this.getVaultBasePath(), ".obsidian", "plugins", DEFAULT_PLUGIN_ID);

      const result = await updatePluginFromLatestRelease({
        repository: DEFAULT_PLUGIN_RELEASE_REPOSITORY,
        pluginId: DEFAULT_PLUGIN_ID,
        pluginDirectoryPath,
        temporaryDirectoryPath,
        requestJson: (url) => requestGitHubJson(url),
        requestArrayBuffer: (url) => requestGitHubArrayBuffer(url),
        fileSystem: {
          mkdir: async (path, options) => {
            await fsModule.promises.mkdir(path, options);
          },
          writeFile: async (path, data) => {
            await fsModule.promises.writeFile(path, data);
          },
          copyFile: (fromPath, toPath) => fsModule.promises.copyFile(fromPath, toPath),
          rm: async (path, options) => {
            await fsModule.promises.rm(path, options);
          }
        },
        joinPath: (...parts) => pathModule.join(...parts)
      });

      new Notice(`플러그인을 ${result.version} 버전으로 업데이트했습니다. Obsidian을 다시 시작하거나 플러그인을 다시 로드하세요.`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "플러그인 업데이트에 실패했습니다.");
    }
  }

  private createGraphifyProvider(): {
    isDesktop: boolean;
    getRunStatus: () => GraphifyRunStatus;
    checkAvailability: (executable: string) => Promise<GraphifyAvailability>;
    checkAgentRunner: ReturnType<ReturnType<typeof createGraphifyObsidianBridge>["createProvider"]>["checkAgentRunner"];
  } {
    return this.createGraphifyBridge().createProvider();
  }

  private async runGraphifyForCurrentProject(runMode: GraphifyRunMode): Promise<void> {
    const currentProject = this.settings.currentProject;

    if (currentProject === null) {
      await this.setGraphifyRunStatus({ kind: "failure", message: "현재 프로젝트가 없어 graphify를 실행할 수 없습니다." });
      return;
    }

    const nodeRequire = getDesktopRequire();
    const runExecutable = createNodeExecutableRunner(nodeRequire);

    if (!Platform.isDesktop || nodeRequire === null || runExecutable === null) {
      await this.setGraphifyRunStatus({ kind: "failure", message: "graphify 실행은 Desktop Obsidian에서만 지원합니다." });
      return;
    }

    const executable = resolveGraphifyExecutable(this.settings.graphifyExecutablePath);
    await this.createGraphifyBridge().runGraphify({
      projectFolderPath: currentProject.localFolderPath,
      executable,
      timeoutMilliseconds: this.settings.graphifyTimeoutSeconds * 1000,
      graphifyRunMode: runMode
    });
  }

  private async setGraphifyRunStatus(status: GraphifyRunStatus): Promise<void> {
    this.graphifyRunStatus = status;
    await this.refreshSyncPanelViews();
  }

  private async openGraphifyOutput(outputFile: GraphifyOutputFileState): Promise<void> {
    await this.createGraphifyBridge().openOutput(outputFile);
  }

  private async copyGraphifyMessage(message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(message);
      new Notice("graphify 메시지를 복사했습니다.");
    } catch {
      new Notice("graphify 메시지를 복사할 수 없습니다.");
    }
  }

  private createGraphifyBridge(): ReturnType<typeof createGraphifyObsidianBridge> {
    if (this.graphifyBridge !== null) {
      return this.graphifyBridge;
    }

    this.graphifyBridge = createGraphifyObsidianBridge({
      isDesktop: Platform.isDesktop,
      getRunExecutable: () => createNodeExecutableRunner(getDesktopRequire()),
      getVaultBasePath: () => this.getVaultBasePath(),
      projectFolderExists: (path) => createVaultStorageAdapter(this).exists(path),
      checkExecutable: (executable) => this.checkExecutableAvailable(executable),
      homeRelativePathExists: (path) => this.homeRelativePathExists(path),
      homeRelativeFileContains: (path, text) => this.homeRelativeFileContains(path, text),
      projectRelativePathExists: (path) => createVaultStorageAdapter(this).exists(path),
      projectRelativeFileContains: (path, text) => this.projectRelativeFileContains(path, text),
      openMarkdown: (path) => openVaultMarkdownFile(this, path),
      openVaultPath: (path) => this.app.workspace.openLinkText(path, "", "tab", { active: true }),
      openExternalUrl: (url, target, features) => window.open(url, target, features) !== null,
      copyGeneratedOutputToVaultRoot: (projectFolderPath) => this.copyGraphifyOutputToVaultRoot(projectFolderPath),
      verifyGraphifyOutputFiles: () => this.verifyGraphifyOutputFiles(),
      writeGraphifyRunLog: (log) => this.writeGraphifyRunLog(log),
      toFileUrl: (path) => {
        const nodeRequire = getDesktopRequire();

        if (nodeRequire === null) {
          throw new Error("Desktop Node 런타임을 사용할 수 없습니다.");
        }

        return pathToFileUrl(this.resolveVaultPath(path, nodeRequire), nodeRequire);
      },
      setStatus: (status) => this.setGraphifyRunStatus(status),
      getRunStatus: () => this.graphifyRunStatus,
      showNotice: (message) => new Notice(message),
      confirmGraphifyAgentRun: (message) => window.confirm(message)
    });

    return this.graphifyBridge;
  }

  private getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;

    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("현재 vault 어댑터에서 로컬 파일 시스템 경로를 확인할 수 없습니다.");
    }

    return adapter.getBasePath();
  }

  private resolveVaultPath(vaultRelativePath: string, nodeRequire: DesktopRequire): string {
    const pathModule = nodeRequire("path") as typeof import("path");

    return resolveVaultAbsolutePath(this.getVaultBasePath(), vaultRelativePath, (basePath, relativePath) =>
      pathModule.join(basePath, relativePath)
    );
  }

  private async copyGraphifyOutputToVaultRoot(projectFolderPath: string): Promise<void> {
    const storage = createVaultStorageAdapter(this);
    const outputFileNames = ["GRAPH_REPORT.md", "graph.json", "graph.html"];
    let copiedCount = 0;

    await storage.mkdir("graphify-out").catch(() => undefined);

    for (const fileName of outputFileNames) {
      const sourcePath = `${projectFolderPath}/graphify-out/${fileName}`;

      if (!(await storage.exists(sourcePath))) {
        continue;
      }

      await storage.write(`graphify-out/${fileName}`, await storage.read(sourcePath));
      copiedCount += 1;
    }

    if (copiedCount === 0) {
      throw new Error("graphify 결과 파일을 찾을 수 없습니다.");
    }
  }

  private async writeGraphifyRunLog(log: string): Promise<void> {
    const storage = createVaultStorageAdapter(this);

    await storage.mkdir("graphify-out").catch(() => undefined);
    await storage.write("graphify-out/latest-run.log", log);
  }

  private async verifyGraphifyOutputFiles(): Promise<{ ok: true } | { ok: false; missingFiles: string[] }> {
    const storage = createVaultStorageAdapter(this);
    const outputFileNames = ["GRAPH_REPORT.md", "graph.json", "graph.html"];
    const missingFiles: string[] = [];

    for (const fileName of outputFileNames) {
      if (!(await storage.exists(`graphify-out/${fileName}`).catch(() => false))) {
        missingFiles.push(fileName);
      }
    }

    return missingFiles.length === 0 ? { ok: true } : { ok: false, missingFiles };
  }

  private async checkExecutableAvailable(executable: string): Promise<boolean> {
    const runExecutable = createNodeExecutableRunner(getDesktopRequire());

    if (runExecutable === null) {
      return false;
    }

    try {
      await runExecutable("which", [executable], {
        cwd: this.getVaultBasePath(),
        timeoutMilliseconds: 3_000,
        maxBufferBytes: 1024 * 1024
      });
      return true;
    } catch {
      return false;
    }
  }

  private async homeRelativePathExists(homeRelativePath: string): Promise<boolean> {
    const nodeRequire = getDesktopRequire();

    if (nodeRequire === null) {
      return false;
    }

    const osModule = nodeRequire("os") as typeof import("os");
    const pathModule = nodeRequire("path") as typeof import("path");
    const fsModule = nodeRequire("fs") as typeof import("fs");
    const targetPath = pathModule.join(osModule.homedir(), homeRelativePath);

    try {
      await fsModule.promises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async projectRelativeFileContains(path: string, text: string): Promise<boolean> {
    const storage = createVaultStorageAdapter(this);

    try {
      return (await storage.read(path)).includes(text);
    } catch {
      return false;
    }
  }

  private async homeRelativeFileContains(homeRelativePath: string, text: string): Promise<boolean> {
    const nodeRequire = getDesktopRequire();

    if (nodeRequire === null) {
      return false;
    }

    const osModule = nodeRequire("os") as typeof import("os");
    const pathModule = nodeRequire("path") as typeof import("path");
    const fsModule = nodeRequire("fs") as typeof import("fs");
    const targetPath = pathModule.join(osModule.homedir(), homeRelativePath);

    try {
      return (await fsModule.promises.readFile(targetPath, "utf8")).includes(text);
    } catch {
      return false;
    }
  }
}

function createVaultStorageAdapter(plugin: ConfluenceObsidianSyncPlugin): ProjectStorageAdapter {
  return {
    exists: (path) => plugin.app.vault.adapter.exists(path),
    mkdir: (path) => plugin.app.vault.adapter.mkdir(path),
    read: (path) => plugin.app.vault.adapter.read(path),
    write: (path, data) => plugin.app.vault.adapter.write(path, data),
    list: (path) => plugin.app.vault.adapter.list(path),
    rename: (fromPath, toPath) => plugin.app.vault.adapter.rename(fromPath, toPath)
  };
}

async function requestGitHubJson(url: string): Promise<unknown> {
  const response = (await requestUrl({
    url,
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    throw: false
  })) as { status: number; json: unknown };

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub Release 정보를 가져오지 못했습니다. HTTP ${response.status}`);
  }

  return response.json;
}

async function requestGitHubArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = (await requestUrl({
    url,
    method: "GET",
    headers: {
      Accept: "application/octet-stream"
    },
    throw: false
  })) as { status: number; arrayBuffer: ArrayBuffer };

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub Release 파일을 다운로드하지 못했습니다. HTTP ${response.status}`);
  }

  return response.arrayBuffer;
}

function loadRequiredDesktopModule<T>(nodeRequire: DesktopRequire, moduleName: string): T {
  try {
    return nodeRequire(moduleName) as T;
  } catch {
    throw new Error(`Desktop Node 모듈을 사용할 수 없습니다: ${moduleName}`);
  }
}

async function openVaultMarkdownFile(plugin: ConfluenceObsidianSyncPlugin, path: string): Promise<void> {
  await openVaultMarkdownFileFromObsidian<TFile>(
    {
      getFileByPath: (filePath) => plugin.app.vault.getFileByPath(filePath),
      fileExists: (filePath) => plugin.app.vault.adapter.exists(filePath),
      openFileInNewTab: async (file) => {
        const leaf = plugin.app.workspace.getLeaf("tab");

        await leaf.openFile(file, { active: true });
        await plugin.app.workspace.revealLeaf(leaf);
      },
      openPathInNewTab: (filePath) => plugin.app.workspace.openLinkText(filePath, "", "tab", { active: true }),
      showNotice: (message) => new Notice(message),
      wait: delay
    },
    path
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
