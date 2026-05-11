# Confluence Obsidian Sync

Confluence 문서를 Obsidian에서 편집 가능한 로컬 Markdown 작업 사본으로 내려받고, 안전하게 반복 Pull하기 위한 Obsidian 플러그인입니다.

## 새 vault에 수동 설치

1. 플러그인 zip을 생성합니다.

```bash
pnpm run package:plugin
```

2. 생성된 zip을 새 vault의 플러그인 폴더에 풉니다.

```text
dist/confluence-obsidian-sync-0.1.2.zip
```

zip을 풀면 다음 폴더가 생겨야 합니다.

```text
<vault>/.obsidian/plugins/confluence-obsidian-sync/
  main.js
  manifest.json
  styles.css
```

3. Obsidian에서 새 vault를 열고 `Settings > Community plugins`로 이동합니다.
4. Restricted mode를 끄고, Installed plugins 목록에서 `Confluence Obsidian Sync`를 활성화합니다.
5. 플러그인 설정에서 Confluence base URL, Atlassian account email, API token을 입력합니다.
6. 왼쪽 리본 아이콘 또는 명령 팔레트의 `Open Sync Panel`로 Sync Panel을 엽니다.

## 로컬 도구와 플러그인 업데이트

Sync Panel의 `터미널 열기`는 현재 vault 루트를 작업 폴더로 터미널을 엽니다.

Sync Panel의 `플러그인 업데이트`는 GitHub 최신 Release에서 `main.js`, `manifest.json`, `styles.css`만 내려받아 현재 vault의 플러그인 폴더에 교체합니다. 플러그인 설정 파일인 `.obsidian/plugins/confluence-obsidian-sync/data.json`은 덮어쓰지 않습니다.

업데이트 완료 후에는 Obsidian을 다시 시작하거나 플러그인을 다시 로드하세요.

## Pull 결과 확인

Pull Tree 실행 후 결과 요약은 Obsidian Notice로 표시됩니다.
`Open Sync Panel` 명령은 현재 프로젝트와 최근 Pull 리포트 요약을 Obsidian 패널로 표시합니다.
`Force Pull Tree`는 로컬 변경사항 개수가 포함된 확인창 승인 후 로컬 수정 파일을 원격 본문으로 덮어씁니다.
확인창을 취소하면 변경된 로컬 파일 목록을 `logs/latest.md`로 남기고 엽니다.

상세 기록은 vault 루트의 다음 파일에 남습니다.

```text
logs/latest.md
```

예:

```text
logs/latest.md
```

`latest.md`에는 다음 내용이 기록됩니다.

- 추가, 갱신, 안전 삭제, 변경 없음 개수
- 로컬 수정 스킵 파일 경로 링크
- 스킵 사유
- 안전 삭제 이동 경로 링크
- Force Pull 강제 덮어쓰기 파일 경로 링크
- 조회 실패와 변환 경고 개수

로컬 수정 스킵 사유는 다음과 같습니다.

- `local-change`: 마지막 Pull 이후 로컬 Markdown 본문이 변경됨
- `legacy-body-mismatch`: 이전 형식 파일에 content hash가 없고, 원격 변환 본문과 로컬 본문이 다름
- `duplicate-page-id`: 같은 Confluence pageId를 가진 로컬 Markdown 파일이 중복됨
- `disappeared-local-change`: Confluence에서 사라진 페이지지만 로컬 수정이 있어 안전 삭제하지 않음

Notice를 놓쳤거나 스킵된 파일의 원인을 확인해야 하면 `logs/latest.md`를 먼저 확인하세요.
Pull Tree가 끝나면 최신 리포트 파일이 자동으로 열립니다.

## Graphify 선택 연동

Desktop Obsidian에서는 Sync Panel에서 선택 설치된 `graphify` CLI를 실행해 Confluence Markdown 작업 사본을 지식 그래프용 corpus로 분석할 수 있습니다.

- 플러그인은 graphify를 번들하지 않습니다.
- CLI 설치 예: `uv tool install graphifyy` 또는 `pipx install graphifyy`
- `graphify install`은 graphify 자체 assistant hook/platform 설정이 필요할 때 별도로 실행합니다. 이 플러그인은 해당 설정을 대신하지 않습니다.
- 입력 대상은 현재 프로젝트의 `confluence/...` Markdown 산출물 폴더입니다.
- 결과는 vault 루트의 `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`, `graphify-out/graph.html`에서 확인합니다.
- Codex, Claude Code 같은 외부 AI 도구는 vault의 Markdown 파일과 graphify 결과 파일을 직접 읽는 방식으로 사용합니다.

## 개발

```bash
pnpm install
pnpm run verify
pnpm run prepare:current-vault
pnpm run package:plugin
```
