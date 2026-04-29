import type { SyncPanelState } from "./syncPanelState";

export interface SyncPanelActions {
  onPullTree: () => void | Promise<void>;
  onForcePullTree: () => void | Promise<void>;
  onPullCurrentPage: () => void | Promise<void>;
  onPushCurrentPage: () => void | Promise<void>;
  onOpenRootLink: () => void | Promise<void>;
  onOpenLatestReport: () => void | Promise<void>;
}

interface SyncPanelProjectAction {
  label: string;
  title: string;
  description: string;
  onClick: () => void | Promise<void>;
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
  const actionListEl = createElement(containerEl, "div");
  actionListEl.className = "confluence-sync-panel-action-list";
  const actionButtons: HTMLButtonElement[] = [];

  for (const action of createProjectActions(actions)) {
    actionButtons.push(
      appendProjectActionCard(
        actionListEl,
        action,
        !state.canRunProjectActions,
        actionStatusEl,
        actionButtons
      )
    );
  }

  actionSectionEl.append(actionListEl);
  containerEl.append(actionSectionEl);
}

function createProjectActions(actions: SyncPanelActions): SyncPanelProjectAction[] {
  return [
    {
      label: "Pull Tree",
      title: "전체 내려받기",
      description: "현재 프로젝트의 Confluence 트리를 로컬 Markdown으로 갱신합니다.",
      onClick: actions.onPullTree
    },
    {
      label: "Force Pull Tree",
      title: "전체 강제 내려받기",
      description: "로컬 수정본을 백업 없이 원격 본문으로 덮어씁니다.",
      onClick: actions.onForcePullTree
    },
    {
      label: "Pull Current Page",
      title: "현재 문서 내려받기",
      description: "현재 열린 Markdown 파일 1개만 원격 최신 본문으로 갱신합니다. 로컬 수정본이 있으면 연결이 해제된 백업본을 먼저 생성합니다.",
      onClick: actions.onPullCurrentPage
    },
    {
      label: "Push Current Page",
      title: "현재 문서 올리기",
      description: "현재 열린 Markdown 파일 1개를 기존 Confluence 페이지에 업로드합니다.",
      onClick: actions.onPushCurrentPage
    }
  ];
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

function appendProjectActionCard(
  containerEl: HTMLElement,
  action: SyncPanelProjectAction,
  disabled: boolean,
  statusEl: HTMLElement,
  actionButtons: HTMLButtonElement[]
): HTMLButtonElement {
  const cardEl = createElement(containerEl, "button");
  cardEl.className = "confluence-sync-panel-action-card";
  cardEl.type = "button";
  cardEl.disabled = disabled;
  cardEl.setAttribute("aria-label", action.label);

  const textEl = createElement(containerEl, "div");
  textEl.className = "confluence-sync-panel-action-text";
  appendTextElement(textEl, "strong", action.title);
  appendTextElement(textEl, "span", action.description);

  cardEl.append(textEl);
  cardEl.addEventListener("click", () => {
    if (cardEl.disabled) {
      return;
    }

    void runProjectAction(actionButtons, cardEl, statusEl, action.label, action.onClick);
  });
  containerEl.append(cardEl);

  return cardEl;
}

async function runProjectAction(
  actionButtons: HTMLButtonElement[],
  buttonEl: HTMLButtonElement,
  statusEl: HTMLElement,
  label: string,
  onClick: () => void | Promise<void>
): Promise<void> {
  setButtonsDisabled(actionButtons, true);
  buttonEl.setAttribute("aria-busy", "true");
  statusEl.textContent = `${label} 진행 중입니다...`;

  try {
    await onClick();
    statusEl.textContent = `${label} 완료`;
  } catch {
    statusEl.textContent = `${label} 실패`;
  } finally {
    setButtonsDisabled(actionButtons, false);
    buttonEl.removeAttribute("aria-busy");
  }
}

function setButtonsDisabled(buttons: HTMLButtonElement[], disabled: boolean): void {
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  containerEl: HTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  return containerEl.ownerDocument.createElement(tagName);
}
