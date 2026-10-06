# Confluence Obsidian Sync

Confluence 문서를 편집 가능한 로컬 Markdown 작업 사본으로 내려받고, 문서 하나를 다시 업로드하는 무료 로컬 도구입니다. Obsidian 플러그인과 앱 없이 실행하는 Node CLI가 같은 변환·동기화 정책을 사용합니다.

현재 버전: `0.1.64`

## Obsidian 없이 사용하는 CLI

[Vault template](https://github.com/Sharknia/confluence-obsidian-vault-template)을 ZIP 또는 clone으로 받은 뒤 설치하세요.

Node.js 22 이상, npm, 사용자 전용 npm 전역 설치 경로가 필요합니다. Node가 없다면 [Node 공식 설치 안내](https://nodejs.org/en/download)를 확인하세요. Obsidian만 사용할 때는 Node 설치가 필요하지 않습니다.

먼저 `npm prefix --global`로 현재 Node/npm의 설치 위치를 확인하세요. 사용자 전용 경로여야 합니다. macOS·Linux는 `<prefix>/bin`, Windows는 `<prefix>`가 PATH에 있어야 합니다. 공유 설치 경로에 쓰기 권한이 있다는 것만으로 사용자 전용 설치가 되는 것은 아닙니다. [npm 경로 설명](https://docs.npmjs.com/cli/v11/configuring-npm/folders/)을 참고하세요.

받은 vault 폴더에서 다음 한 줄을 실행합니다. 코드 저장소 clone·빌드나 Obsidian 실행은 필요하지 않습니다.

```bash
npm install --global --engine-strict ./cli/confluence-sync-cli.tgz
```

설치 후 다른 작업 폴더에서도 사용할 수 있습니다. 설치한 vault를 기본 대상으로 저장하지 않으므로 명령마다 `--vault`를 지정합니다.

```bash
confluence-sync --version
confluence-sync --help
confluence-sync check --vault '/절대/경로/vault'
confluence-sync status --vault '/절대/경로/vault'
confluence-sync pull-tree --vault '/절대/경로/vault'
confluence-sync pull-page --vault '/절대/경로/vault' --file 'confluence/프로젝트/문서.md'
confluence-sync push-page --vault '/절대/경로/vault' --file 'confluence/프로젝트/문서.md' --yes
```

Windows PowerShell에서도 같은 설치 명령을 사용하며 vault 경로는 `--vault 'C:\Users\사용자\Documents\vault'`처럼 지정합니다.

기존 vault의 `.obsidian/plugins/confluence-obsidian-sync/data.json`에 있는 인증·프로젝트 설정을 그대로 읽고 수정하지 않습니다. CLI로 `init`한 프로젝트는 결과의 `project.localFolderPath`를 `--project`로 지정하세요.

### 업데이트·제거와 설치 문제

새 vault 배포에서 받은 `.tgz`에 같은 설치 명령을 실행하고 `confluence-sync --version`으로 버전을 확인합니다. 전역 CLI는 vault와 독립된 복사본이며, Obsidian의 플러그인 업데이트 버튼은 CLI를 업데이트하지 않습니다.

```bash
npm install --global --engine-strict ./cli/confluence-sync-cli.tgz
confluence-sync --version
npm uninstall --global confluence-obsidian-sync-cli
```

제거해도 vault의 설정·Markdown·백업·로그는 유지됩니다.

- `EBADENGINE`: Node 22 이상으로 실행하세요.
- `EACCES`·`EPERM`: [npm 공식 권한 오류 안내](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/)에 따라 사용자 전용 Node/npm 환경과 설치 경로를 준비하세요. 관리자 권한·`sudo`·광범위한 `chmod`로 우회하지 마세요.
- 설치 후 명령을 찾지 못함: `npm prefix --global`의 실행 경로가 PATH에 있는지 확인하고 새 터미널을 여세요.
- `EEXIST`: 같은 이름의 명령이 있습니다. 원래 프로그램을 확인하세요. `--force`로 덮어쓰지 마세요.
- Node 버전 관리자로 runtime을 바꿈: 전역 설치 경로가 달라질 수 있으므로 받은 패키지로 다시 설치하세요.

설치 스크립트는 shell 설정이나 npm prefix를 자동 변경하지 않습니다. 설치물에 runtime 의존성을 동봉하므로 설치 시 별도 빌드·의존성 다운로드는 없습니다. macOS에서 설치·실행을 검증했으며 Linux·Windows는 CI 검증 대상으로 두고 결과 확인 전입니다.

### 새 폴더에서 시작

Obsidian을 한 번도 사용하지 않은 폴더는 다음 환경변수를 호출 프로세스에 설정합니다. 토큰은 CLI 인자로 받거나 파일에 따로 저장하지 않습니다.

| 환경변수 | 값 |
| --- | --- |
| `CONFLUENCE_BASE_URL` | Confluence HTTPS 사이트 주소. `/wiki` 포함 가능 |
| `CONFLUENCE_USER_EMAIL` | Atlassian 계정 이메일 |
| `CONFLUENCE_API_TOKEN` | API token |

환경변수는 기존 설정의 해당 연결 필드만 덮어씁니다. 회사별 기본 사이트나 루트를 새 CLI 프로젝트에 자동 적용하지 않습니다.

```bash
confluence-sync init --vault '/절대/경로/vault' --root 'https://example.atlassian.net/wiki/spaces/SPACE/pages/123'
confluence-sync pull-tree --vault '/절대/경로/vault' --project 'confluence/프로젝트'
```

`init` 결과의 `project.localFolderPath`를 이후 명령의 `--project`에 사용합니다. 페이지·폴더 URL을 모두 지원합니다. `init`은 로컬 manifest를 만들며 원격 페이지나 Obsidian의 현재 프로젝트 선택을 변경하지 않습니다.

### 명령과 확인 정책

| 명령 | 동작 |
| --- | --- |
| `check` | 인증·연결 확인 |
| `status` | 선택한 프로젝트와 vault 공용 `logs/latest.md`의 요약 |
| `init --root <URL>` | 로컬 프로젝트 생성 또는 재사용 |
| `pull-tree` | 트리 Pull. 로컬 수정본은 스킵하고 원격에서 사라진 문서는 안전 삭제 폴더로 이동 |
| `pull-tree --force --yes` | 로컬 수정본을 백업 없이 원격 본문으로 덮어쓰기 |
| `pull-page --file <경로>` | 문서 하나를 Pull. 로컬 수정본이 있으면 `--yes`가 필요하며 연결 해제 백업 생성 |
| `push-page --file <경로> --yes` | 기존 원격 페이지 하나에 Push. version 충돌 검사 유지 |

`--vault`는 이미 존재하는 폴더의 절대 경로이며 `--project`와 `--file`은 vault 기준 상대 경로입니다. 단일 문서는 선택한 프로젝트 내부에 있어야 하고 frontmatter의 출처 사이트·pageId가 연결 대상과 일치해야 합니다. 출처 정보가 없는 예전 파일은 검증된 Pull Tree 산출물로 다시 시작하세요.

확인 플래그 없이 위험한 명령을 실행하면 `confirmation-required`와 대상·version·로컬 변경 정보를 반환합니다. LLM은 그 결과를 확인하고 사용자가 허용한 범위에서 `--yes`로 다시 실행할 수 있습니다. `--yes`로 version 충돌·출처·경로 검사를 우회할 수 없습니다.

### JSON 결과와 복구

stdout은 JSON 객체 하나이며 종료 코드는 다음과 같습니다.

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 성공 또는 변경 없음 |
| `1` | 설정·인증·연결·파일 접근 등 실행 실패 |
| `2` | 확인 필요, version 충돌, 출처·경로 검사, 다른 동기화 작업의 잠금으로 차단 |
| `3` | 부분 완료 또는 적용 여부 불명 |

`status`와 `reason`, 실제 완료 개수인 `counts`, 실패 단계·경로를 확인하세요. Pull 결과의 `reportWritten`이 false이고 `reportPath`가 null이면 이전 리포트를 이번 결과로 판단하면 안 됩니다. 일부 조회·변환이 실패하면 안전 삭제를 보류합니다.

Push의 `remoteState`는 `applied`, `not-applied`, `unknown`입니다. PUT 응답이 유실된 `unknown` 상태나 원격 성공·로컬 metadata 갱신 실패는 자동 재업로드하지 마세요. 원격 version·본문을 확인한 뒤 로컬 metadata를 맞춰야 합니다. 충돌 검사를 우회하기 위해 version을 임의로 올리지 마세요.

CLI와 업데이트된 플러그인은 `.confluence-sync/operation.lock`을 공유합니다. 잠금이 남아 있다면 실행 중인 작업이 없는지 먼저 확인한 뒤 해당 잠금 파일을 제거합니다. 실행 중 감지된 파일 수정과 경로 충돌은 차단하지만, 공동 잠금을 사용하지 않는 외부 에디터의 모든 동시 편집까지 원자적으로 보호하지는 않습니다. 동기화 중 같은 파일을 동시에 편집하지 마세요.

CLI는 Sync Panel·터미널 열기·플러그인 업데이트 UI를 복제하지 않습니다. Graphify는 기존 CLI로 실행합니다. CLI 설치 패키지는 vault template의 `cli/`에 포함합니다. 플러그인 ZIP은 기존 세 파일만 포함합니다.

## 새 vault에 수동 설치

1. 플러그인 zip을 생성합니다.

```bash
pnpm run package:plugin
```

2. 생성된 zip을 새 vault의 플러그인 폴더에 풉니다.

```text
dist/confluence-obsidian-sync-0.1.64.zip
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

개발 환경은 pnpm을 사용하며 직접 Node 실행도 유지합니다.

```bash
pnpm install --frozen-lockfile
pnpm run build:cli
node dist/cli.mjs --help
pnpm --silent run cli check --vault '/절대/경로/vault'
pnpm run package:cli
```

`cli` 명령 앞에 추가 `--`를 넣지 마세요. `package:cli`는 `dist/confluence-sync-cli.tgz`를 생성합니다. 별도 template 반영은 실제 저장소 경로를 지정합니다.

```bash
VAULT_TEMPLATE_ROOT='/별도/template/저장소' pnpm run prepare:vault
```


```bash
pnpm install
pnpm run verify
pnpm run prepare:current-vault
pnpm run package:plugin
```

실제 인증으로 페이지·폴더 조회와 HTML 첨부 다운로드를 읽기 전용으로 검증하려면 다음을 실행합니다. HTTP status별 개수와 결과 개수만 출력하며 원격 문서를 수정하지 않습니다.

```bash
node scripts/smoke-cli-readonly.mjs --vault '/인증이/설정된/vault'
```
