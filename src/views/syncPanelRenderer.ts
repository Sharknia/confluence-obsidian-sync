import type { SyncPanelState } from "./syncPanelState";

export interface SyncPanelActions {
  onPullTree: () => void | Promise<void>;
  onPushCurrentPage: () => void | Promise<void>;
  onOpenRootLink: () => void | Promise<void>;
  onOpenLatestReport: () => void | Promise<void>;
}

export function renderSyncPanelContent(
  containerEl: HTMLElement,
  state: SyncPanelState,
  actions: SyncPanelActions
): void {
  containerEl.replaceChildren();
  containerEl.classList.add("confluence-sync-panel");

  appendTextElement(containerEl, "h2", "Confluence Sync");

  const statusSectionEl = appendSection(containerEl, "Current Project");
  appendTextElement(statusSectionEl, "p", state.projectName);

  if (state.localFolderPath.length > 0) {
    appendTextElement(statusSectionEl, "p", state.localFolderPath);
  }

  const rootSectionEl = appendSection(containerEl, "Root Content");
  appendTextElement(rootSectionEl, "p", state.rootContentLabel || "루트 콘텐츠 없음");

  if (state.rootUrl.length > 0) {
    appendLink(rootSectionEl, state.rootUrl);
  }

  appendButton(
    rootSectionEl,
    "Open root link",
    actions.onOpenRootLink,
    !state.canRunProjectActions || state.rootUrl.length === 0
  );

  const pullSectionEl = appendSection(containerEl, "Latest Pull");
  appendTextElement(pullSectionEl, "p", state.lastPullText);
  appendButton(
    pullSectionEl,
    "Open latest report",
    actions.onOpenLatestReport,
    !state.canRunProjectActions || state.latestReportPath.length === 0
  );

  const issueSectionEl = appendSection(containerEl, "Recent Issues");
  appendTextElement(issueSectionEl, "p", state.recentIssueText);

  if (state.recentIssueLines.length > 0) {
    const issueListEl = createElement(containerEl, "ul");

    for (const issueLine of state.recentIssueLines) {
      appendTextElement(issueListEl, "li", issueLine.replace(/`/gu, ""));
    }

    issueSectionEl.append(issueListEl);
  }

  const actionSectionEl = createElement(containerEl, "div");
  actionSectionEl.className = "confluence-sync-panel-actions";
  const actionStatusEl = appendTextElement(actionSectionEl, "p", "");
  actionStatusEl.setAttribute("aria-live", "polite");
  appendPullButton(actionSectionEl, actions.onPullTree, !state.canRunProjectActions, actionStatusEl);
  containerEl.append(actionSectionEl);
}

function appendSection(containerEl: HTMLElement, heading: string): HTMLElement {
  const sectionEl = createElement(containerEl, "section");
  sectionEl.className = "confluence-sync-panel-section";
  appendTextElement(sectionEl, "h3", heading);
  containerEl.append(sectionEl);

  return sectionEl;
}

function appendTextElement<K extends keyof HTMLElementTagNameMap>(
  containerEl: HTMLElement,
  tagName: K,
  text: string
): HTMLElementTagNameMap[K] {
  const element = createElement(containerEl, tagName);
  element.textContent = text;
  containerEl.append(element);

  return element;
}

function appendLink(containerEl: HTMLElement, url: string): HTMLAnchorElement {
  const linkEl = createElement(containerEl, "a");
  linkEl.href = url;
  linkEl.textContent = url;
  linkEl.rel = "noreferrer";
  containerEl.append(linkEl);

  return linkEl;
}

function appendButton(
  containerEl: HTMLElement,
  text: string,
  onClick: () => void | Promise<void>,
  disabled: boolean
): HTMLButtonElement {
  const buttonEl = createElement(containerEl, "button");
  buttonEl.textContent = text;
  buttonEl.disabled = disabled;
  buttonEl.addEventListener("click", () => {
    void onClick();
  });
  containerEl.append(buttonEl);

  return buttonEl;
}

function appendPullButton(
  containerEl: HTMLElement,
  onClick: () => void | Promise<void>,
  disabled: boolean,
  statusEl: HTMLElement
): HTMLButtonElement {
  const buttonEl = createElement(containerEl, "button");
  buttonEl.textContent = "Pull Tree";
  buttonEl.disabled = disabled;
  buttonEl.addEventListener("click", () => {
    if (buttonEl.disabled) {
      return;
    }

    void runPullAction(buttonEl, statusEl, onClick);
  });
  containerEl.append(buttonEl);

  return buttonEl;
}

async function runPullAction(
  buttonEl: HTMLButtonElement,
  statusEl: HTMLElement,
  onClick: () => void | Promise<void>
): Promise<void> {
  buttonEl.disabled = true;
  buttonEl.textContent = "Pull 진행 중...";
  statusEl.textContent = "Pull 진행 중입니다...";

  try {
    await onClick();
    statusEl.textContent = "Pull 완료";
  } catch {
    statusEl.textContent = "Pull 실패";
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = "Pull Tree";
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  containerEl: HTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  return containerEl.ownerDocument.createElement(tagName);
}
