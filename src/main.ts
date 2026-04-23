import { Notice, Plugin } from "obsidian";
import {
  OPEN_SYNC_PANEL_COMMAND_ID,
  PULL_TREE_COMMAND_ID,
  PUSH_CURRENT_PAGE_COMMAND_ID
} from "./commands/commandIds";

export default class ConfluenceObsidianSyncPlugin extends Plugin {
  override async onload(): Promise<void> {
    this.addCommand({
      id: OPEN_SYNC_PANEL_COMMAND_ID,
      name: "Open Sync Panel",
      callback: () => {
        new Notice("Confluence Sync Panel은 다음 Epic에서 구현됩니다.");
      }
    });

    this.addCommand({
      id: PULL_TREE_COMMAND_ID,
      name: "Pull Tree",
      callback: () => {
        new Notice("Confluence Pull Tree는 Confluence 연결 설정 이후 사용할 수 있습니다.");
      }
    });

    this.addCommand({
      id: PUSH_CURRENT_PAGE_COMMAND_ID,
      name: "Push Current Page",
      callback: () => {
        new Notice("Confluence Push Current Page는 단일 문서 업로드 Epic에서 구현됩니다.");
      }
    });
  }
}
