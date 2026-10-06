# Obsidian 없이 동기화하는 CLI 작업계획서

작성일: 2026-10-06

상태: `0.1.63` 구현과 로컬·실제 API 읽기 검증 완료. 실제 Push 검증은 전용 페이지 지정 후 수행한다.

## 목표와 구현 방향

Obsidian을 실행하지 않아도 LLM과 사용자가 터미널에서 Confluence 문서를 Pull하고, 로컬 Markdown을 편집한 뒤 문서 하나를 Push할 수 있게 한다. Obsidian 플러그인과 CLI는 같은 변환·충돌 검사·동기화 정책을 사용한다.

기존 저장소에 Node CLI 진입점과 HTTP·파일 시스템 어댑터를 추가한다. 별도 서버, MCP 서버, 새 동기화 엔진, npm 공개 배포는 첫 구현에 포함하지 않는다. 아래 명령과 결과 계약은 `0.1.63` 구현에 반영했다.

## 현재 코드에서 재사용할 부분

| 기존 코드 | 재사용할 역할 | 필요한 변경 |
| --- | --- | --- |
| `src/commands/pullTreeCommand.ts` | 페이지·폴더 트리 Pull, HTML 첨부 처리, Force Pull, 리포트 | Obsidian 기본 fetch 분리, 구조화된 결과 반환 |
| `src/commands/pullCurrentPageCommand.ts` | 단일 문서 Pull과 연결 해제 백업 | 파일 경로 주입, 확인 필요 상태와 결과 반환 |
| `src/commands/pushCurrentPageCommand.ts` | 단일 문서 Push, version 충돌 차단, frontmatter 갱신 | 파일 경로 주입, 확인 필요 상태와 결과 반환 |
| `src/confluence/` | 인증, 연결 확인, pagination, 페이지·첨부 API | Node transport 연결, PUT 반영 상태 보존 |
| `src/projects/projectStorage.ts`, `src/projects/htmlAttachmentStorage.ts` | 저장 어댑터 계약과 파일 적용 | 완료 개수·실패 단계 반환, Node 파일 시스템 어댑터 연결 |
| `src/projects/pageMarkdown.ts` | frontmatter와 본문 처리 | 단일 문서 명령을 위한 출처 URL 읽기·검증 |
| `src/projects/pullSyncPolicy.ts` | 로컬 수정 보호, 안전 삭제 계획 | CLI에서도 동일하게 호출 |
| `src/projects/createProjectFromRootUrl.ts` | 루트 페이지·폴더 프로젝트 생성 | CLI에서 직접 호출 |
| `src/markdown/` | Storage HTML과 Markdown 변환 | 그대로 재사용 |
| `src/settings/defaultSettings.ts` | 기존 설정 형식과 정규화 | CLI 입력은 별도 검증 후 재사용 |

기존 command의 `Promise<void>`와 Notice 중심 결과를 구조화된 반환값으로 정리했다. Notice 문구를 파싱하지 않으며, 하위 저장 함수가 실패해도 완료 개수·경로·실패 단계를 보존한다.

공통 command 안의 Obsidian 기본 fetch를 제거하고 플러그인 진입점에서 구성한다. 동적 import라도 esbuild의 Node ESM 번들에서는 Obsidian 정적 import가 최상위에 남으므로 callback 주입만으로 해결하지 않는다. 트리·첨부 수집·다운로드의 기존 조합 로직은 transport를 받는 공통 함수로 유지하고, 플러그인과 CLI가 각자의 transport로 같은 조합을 사용한다. CLI에 첨부 처리 코드를 복제하지 않는다.

`obsidian`의 타입 전용 import는 기존대로 유지할 수 있다. 공통 command의 런타임 import 경로에는 `obsidian`, `window`, `document` 의존성이 없어야 하며, CLI 빌드에서 `obsidian`을 external로 지정해 문제를 숨기지 않는다. Markdown 변환기의 `document`는 `linkedom`이 생성한 로컬 객체이므로 브라우저 전역 의존성과 구별한다. 현재 Push 본문 형식은 ADF가 아닌 Confluence `storage`이며, CLI도 기존 변환 결과를 그대로 사용한다.

## 첫 구현의 명령 범위

`pnpm run build:cli`로 먼저 빌드한 뒤 `node dist/cli.mjs <명령> ...`으로 실행한다. 개발 저장소에서는 같은 실행 파일을 호출하는 `pnpm --silent run cli <명령> ...`도 지원한다. `cli` script에는 자동 빌드를 넣지 않아 실행 결과에 빌드 로그가 섞이지 않게 한다. pnpm 10에서는 추가 `--`가 실행 파일에 전달되므로 명령 앞에 넣지 않는다.

`dist/cli.mjs`는 Node 실행용 단일 번들이며 플러그인 `dist/main.js`와 분리한다. Node 22 이상을 기준으로 하며 인자 처리는 `node:util`의 `parseArgs`를 사용한다.

| 명령 | 입력과 동작 |
| --- | --- |
| `check` | 인증·Confluence 연결 확인. 원격 쓰기 없음 |
| `status` | 선택한 프로젝트와 vault 공용 최신 Pull 리포트 요약. 원격 호출 없음 |
| `init --root <URL>` | 명시한 페이지·폴더 루트로 프로젝트 manifest 생성. 원격 페이지 생성 없음 |
| `pull-tree` | 프로젝트 트리 Pull. 로컬 수정 보호와 안전 삭제 유지 |
| `pull-tree --force --yes` | 확인 플래그를 받은 뒤 기존 Force Pull 정책으로 실행 |
| `pull-page --file <경로>` | 지정한 문서 하나를 Pull. 로컬 수정이 있으면 `--yes` 확인 후 백업·덮어쓰기 |
| `push-page --file <경로> --yes` | 지정한 문서 하나를 기존 원격 페이지에 Push. version 검사 유지 |

모든 실행 명령에서 이미 존재하는 폴더의 `--vault <절대 경로>`를 필수로 받는다. `--help`는 vault 없이 사용할 수 있다. 파일 경로와 `--project` 경로는 vault 기준 상대 경로로 받는다. 현재 작업 디렉터리나 Obsidian 활성 탭으로 대상 vault·문서를 추측하지 않는다.

프로젝트 선택이 필요한 명령은 `--project <프로젝트 폴더>`를 지원한다. 해당 폴더의 `.confluence-sync/manifest.json`을 읽는다. 옵션이 없으면 기존 플러그인 설정의 `currentProject`가 가리키는 manifest를 읽고 검증한다. manifest의 폴더·루트 정보가 선택한 실제 경로·설정과 다르면 차단한다. 둘 다 없으면 `project-not-configured`로 종료하고 명시적인 `init` 실행을 안내한다.

```bash
# 기존 vault의 설정과 프로젝트 사용
node dist/cli.mjs check --vault /path/to/vault
node dist/cli.mjs pull-tree --vault /path/to/vault
node dist/cli.mjs pull-page --vault /path/to/vault --file 'confluence/프로젝트/문서.md'
node dist/cli.mjs push-page --vault /path/to/vault --file 'confluence/프로젝트/문서.md' --yes

# Obsidian을 한 번도 실행하지 않은 폴더에서도 환경변수로 시작
node dist/cli.mjs init --vault /path/to/vault --root 'https://example.atlassian.net/wiki/spaces/SPACE/pages/123'
node dist/cli.mjs pull-tree --vault /path/to/vault --project 'confluence/프로젝트'

# 개발 저장소에서 사용할 동등한 실행 경로
pnpm --silent run cli check --vault /path/to/vault
```

`init` 결과에는 생성·재사용한 프로젝트 폴더와 manifest 경로를 포함한다. 이후 명령은 이 경로를 `--project`로 사용한다. 첫 구현에서 CLI는 플러그인 `data.json`을 수정하거나 Obsidian의 현재 프로젝트 선택을 바꾸지 않는다.

`logs/latest.md`는 vault 전체의 공용 리포트다. `status`에서도 공용 기록임을 표시하며 선택한 프로젝트의 최근 실행이라고 단정하지 않는다. 프로젝트별 이력 저장소는 추가하지 않는다.

Sync Panel 열기, 터미널 열기, 링크·리포트 화면 열기는 CLI 명령으로 복제하지 않는다. 파일 경로를 출력하면 호출자가 직접 읽을 수 있다. Graphify는 기존 CLI를 직접 실행할 수 있으므로 별도 래퍼를 만들지 않는다. 플러그인 업데이트 CLI는 후속 범위다. vault 동봉·전역 설치 패키징은 별도의 [배포 작업계획서](vault-cli-distribution-plan.md)에서 다룬다.

## 설정과 인증 계약

기존 vault는 `.obsidian/plugins/confluence-obsidian-sync/data.json`을 읽는다. 인증 정보의 별도 사본을 만들지 않는다. 파일이 없으면 환경변수만으로 실행할 수 있으며 `.obsidian` 폴더나 플러그인 설치를 요구하지 않는다.

지원할 환경변수는 기존 smoke script와 같은 이름을 쓴다.

- `CONFLUENCE_BASE_URL`
- `CONFLUENCE_USER_EMAIL`
- `CONFLUENCE_API_TOKEN`

명시된 환경변수는 해당 연결 필드만 덮어쓴다. 환경변수 값을 `data.json`이나 manifest에 인증 정보로 저장하지 않는다. 토큰을 명령행 인자로 받거나 출력하지 않는다.

CLI에서는 다음 입력을 실행 전에 검증한다.

- 설정 파일이 존재하지만 JSON이 손상되었다면 오류로 종료한다. 기존 loader의 예외 시 기본값 반환으로 오류를 숨기지 않는다.
- 연결 URL·이메일·토큰이 누락되면 요청 전에 종료한다. 설정이 없는 CLI에 제품의 회사별 기본 URL·루트를 자동 적용하지 않는다.
- 선택한 manifest의 URL과 인증 대상 URL이 일치하는지 검사한다. `init --root`도 같은 Confluence 사이트의 URL만 허용한다.
- `pull-page`·`push-page`는 선택한 프로젝트 내부의 Markdown 파일만 대상으로 하며 기존 frontmatter 필수 조건을 검사한다.
- 단일 문서에서는 `confluenceSourceUrl`을 읽고 기존 URL 파서를 재사용해 사이트와 pageId가 선택한 연결·frontmatter와 모두 일치하는지 검사한다. 다른 사이트의 파일을 프로젝트 폴더에 복사해도 통과하지 못한다. 검사 실패 시 해당 pageId 조회나 PUT 전에 `source-not-verified`로 차단하며 `--yes`로 우회하지 않는다.
- 출처 URL이 없거나 유효하지 않은 예전 문서는 CLI 단일 문서 명령으로 추측해서 연결하지 않는다. 선택한 사이트의 `pull-tree`에서 검증된 산출물을 사용하도록 안내한다. URL 읽기·검증 함수는 공통 로직에 두고, CLI 진입점에서 이 추가 입력 검증을 필수로 적용한다. Obsidian의 기존 예전 문서 처리 방식은 유지한다.

## 결과와 확인 정책

CLI는 대화형 질문을 띄우지 않는다. 필요한 확인 플래그가 없으면 `confirmation-required`로 종료하고 대상 파일, pageId, 원격 version, 로컬 변경 개수 등 확인 정보를 반환한다. `--yes`는 확인 절차만 대체하며 version 충돌·경로 검사·백업을 우회하지 않는다.

Obsidian은 기존 확인창과 Notice를 유지한다. 공통 command가 구조화된 결과를 반환하고, CLI는 그 결과를 출력한다. 확인 필요 정보도 문자열에서 추출하지 않고 필드로 전달한다. Force Pull 취소 리포트 등 기존 플러그인 동작은 유지한다.

stdout에는 실행 결과 JSON 객체 하나만 출력한다. 진행 메시지는 stderr로 보내며 원문 본문·이메일·토큰·Authorization header를 출력하지 않는다.

```json
{
  "command": "pull-tree",
  "status": "partial",
  "reason": "fetch-failed",
  "message": "일부 페이지 조회 실패로 안전 삭제를 보류했습니다.",
  "reportPath": "logs/latest.md",
  "counts": {
    "created": 2,
    "updated": 3,
    "safeDeleted": 0,
    "skippedLocalChanges": 1,
    "fetchFailures": 1,
    "conversionFailures": 0
  }
}
```

| 종료 코드 | 결과 계약 |
| --- | --- |
| `0` | 성공 또는 변경 없음. 변환 경고는 결과 필드에 포함 |
| `1` | 설정·인증·네트워크·파일 저장 등 실행 실패. 문서 변경이 없거나 원격 미반영이 확인된 경우 |
| `2` | 확인 필요, version 충돌, vault 잠금 등 실행 차단·취소 |
| `3` | 부분 완료 또는 적용 여부 불명: 조회·변환·첨부 실패, 로컬 수정 스킵, 파일 적용 중 실패, 원격 성공·로컬 실패, PUT 반영 여부 불명 |

`status`는 `success`, `unchanged`, `error`, `blocked`, `partial`, `unknown`을 사용한다. `reason`으로 구체적인 원인을 구분한다. 원격 변경 결과는 `remoteState: applied | not-applied | unknown`으로 구분하며 boolean만으로 미반영과 불명을 합치지 않는다. 원격 업로드만 성공한 경우 `remoteState: applied`, `localUpdated: false`, 갱신 version을 반환한다.

PUT이 전송된 뒤 timeout·연결 종료가 발생하면 `remoteState: unknown`으로 반환한다. HTTP 200을 받았으면 반영 성공 사실을 보존하고, 응답 JSON 파싱·본문 읽기·후속 GET 실패로 일반 네트워크 실패에 덮이지 않게 한다. 전송 전 차단과 API가 명시적으로 갱신을 거절한 상태는 `not-applied`이며, 5xx 등 반영 여부를 확정할 수 없는 응답은 `unknown`으로 처리한다.

반영 여부 불명은 `status: unknown`, 종료 코드 `3`이며 자동 재전송하지 않는다. 필요할 때 읽기 재조회로 pageId·version·본문을 대조한다. version 증가만으로 이번 Push 성공을 단정하지 않으며 본문 정규화나 다른 편집 때문에 확인할 수 없으면 불명 상태를 유지한다. LLM에는 원격 상태 확인과 로컬 metadata 복구를 먼저 안내한다.

파일 저장·안전 삭제 이동·HTML 첨부 적용 함수는 실패해도 완료 개수, 완료한 경로, 실패 경로와 단계를 반환한다. 결과의 `counts`는 계획 개수가 아닌 실제 완료 개수다. 이미 변경된 파일이 있으면 `partial`로 보고하며, 실패한 쓰기가 일부 파일을 변경했을 가능성이 있으면 완료 개수가 0이어도 일반 무변경 실패로 분류하지 않는다. 전체 트랜잭션이나 롤백 엔진은 추가하지 않는다.

리포트는 성공뿐 아니라 가능한 실패·부분 완료에서도 기록한다. `reportWritten`으로 이번 실행의 기록 여부를 반환하고 기록 실패 시 `reportPath: null`로 반환한다. 이전 `logs/latest.md`를 이번 결과처럼 연결하지 않는다. 파일 적용 후 리포트 저장이 실패하면 `report-write-failed`와 실제 적용 결과를 보존한다.

별도 전체 diff UI나 광범위한 dry-run 엔진은 첫 구현에 넣지 않는다. 위험한 명령은 확인 플래그 없이 실행해 실행 전 확인 정보를 받고, 사용자가 허용한 범위에서 다시 실행한다. 이때 원격 version 등 조건을 재검사한다. 기존 취소 리포트 기록 외에 승인되지 않은 원격 쓰기·문서 덮어쓰기는 하지 않는다.

## 파일 보호와 동시 실행

Node 저장 어댑터의 모든 경로는 지정한 vault 내부로 제한한다. `..`, vault 밖의 절대 경로, 외부로 이어지는 심볼릭 링크를 통해 읽기·쓰기·이동이 발생하지 않도록 실제 경로와 기존 상위 경로를 검사한다. `.obsidian` 설정은 지정한 설정 파일만 읽는다.

같은 vault에서 CLI 여러 개 또는 플러그인과 CLI가 동시에 문서를 갱신하지 못하게 vault 루트의 `.confluence-sync/operation.lock`을 사용한다. 범위는 vault 하나이며, native 파일 생성의 배타 모드를 사용한다. 프로세스 식별 정보와 잠금 소유 식별자를 기록하고 자신의 잠금만 해제한다. 잠금 파일은 Git에서 제외한다.

- CLI의 `init`, 트리·문서 Pull/Push와 플러그인의 프로젝트 생성·Pull/Push가 같은 잠금을 사용한다.
- `finally`에서 잠금을 해제한다. 프로세스 강제 종료로 남은 잠금은 자동으로 무시하지 않고 경로와 복구 절차를 안내한다.
- CLI는 플러그인 설정을 읽기만 하므로 별도의 설정 병합·현재 프로젝트 자동 변경은 구현하지 않는다.
- 원격 요청 중 사용자가 로컬 파일을 편집했으면 쓰기 직전에 현재 파일과 실행 시점 snapshot을 비교해 덮어쓰기를 차단한다. 잠금만으로 에디터의 일반 편집까지 막는다고 가정하지 않는다.
- 같은 비교를 안전 삭제 이동과 HTML 첨부 교체에도 적용한다. 새 파일은 실제 생성 시 배타적으로 생성해 계획 수립 뒤 다른 파일이 같은 경로에 생겼으면 덮어쓰지 않는다. Push 이후 metadata 갱신 전에 로컬 파일이 바뀌었으면 수정본을 보존하고 원격 성공·로컬 미갱신을 반환한다.

snapshot 비교는 감지한 변경을 보호하는 낙관적 검사다. 공동 잠금에 참여하지 않는 외부 에디터가 최종 검사와 쓰기 사이에 수정하는 경우까지 원자적인 동시 편집 보호를 보장하지 않는다. 동기화 중 같은 파일의 외부 편집을 피하도록 사용 안내에 명시한다.

기존 보호 정책인 로컬 수정 스킵, 단일 Pull 백업, Force Pull 확인, Push version 검사, 불완전한 Pull의 안전 삭제 보류를 CLI에도 적용한다. Force Pull은 기존처럼 백업 없는 덮어쓰기이며 확인 정보에 이를 명시한다.

## 단계별 작업과 완료 기준

### 1단계 실행 환경 분리와 공통 결과 계약 정리

공통 command에서 Obsidian transport의 동적 import와 기본 fetch를 분리한다. 환경별 진입점이 필요한 의존성을 명시적으로 주입하고, 기존 API 조합·첨부 처리 로직은 transport만 바꿔 재사용한다.

Pull Tree, Pull Current Page, Push Current Page에 구조화된 결과를 반환하도록 한다. 하위 파일 적용 함수의 부분 완료 정보와 `pageUpdate.ts`의 원격 반영 상태도 보존한다. Notice와 확인창은 기존대로 동작하게 유지하고 필요한 곳에만 공통 결과 타입을 둔다.

완료 기준: 공통 command를 import한 Node ESM 번들에 Obsidian 런타임 import가 없고, CLI 결과 판정에 Notice 문구 파싱이 없다. N번째 파일 저장·이동·첨부 적용과 리포트 기록 실패, PUT 응답 유실, HTTP 200 이후 응답 파싱·후속 GET 실패를 재현해 결과가 실제 적용 상태를 보존한다. 기존 플러그인 테스트와 신규 결과 테스트가 통과한다.

### 2단계 Node 실행 어댑터와 입력 보호

`src/confluence/nodeRequestTransport.ts`에 HTTP transport, `src/platform/nodeVaultStorage.ts`에 양쪽 진입점의 저장 어댑터, `src/cli/main.ts`에 설정·프로젝트 입력 처리를 구현했다. `src/platform/vaultOperationLock.ts`에 공통 vault 잠금을 추가했다. 기존 API와 변환 함수는 복제하지 않는다.

HTTP 어댑터는 status, JSON, text, ArrayBuffer를 공통 transport 계약에 맞춘다. HTTP status 수신과 응답 본문 읽기·JSON 파싱의 실패를 구별해 수신한 성공 status를 잃지 않게 한다. JSON이 아닌 첨부 응답과 HTTP 오류도 처리하고 인증 정보가 다른 사이트로 전달되지 않도록 redirect를 검증한다. 첨부 REST 다운로드의 HTTPS `api.media.atlassian.com` redirect만 추가 허용하며, 해당 이동에는 인증·쿠키 등 기존 헤더를 전달하지 않는다. timeout을 두며 쓰기 요청은 자동 재시도하지 않는다.

완료 기준: 임시 vault와 로컬 HTTP 서버로 pagination·비 JSON HTML 첨부·인증 오류·timeout·경로 탈출·심볼릭 링크·동시 실행을 검사한다. 다른 사이트·pageId 불일치·출처 없는 문서가 단일 문서 API 요청 전에 차단되는지 확인한다. 저장·안전 삭제 직전의 로컬 변경, 신규 경로의 뒤늦은 충돌과 Push 후 로컬 변경을 검사한다. CLI 경로에서 Obsidian 런타임을 불러오지 않는다.

### 3단계 CLI 진입점과 빌드 연결

`src/cli/main.ts`에서 명령·옵션을 해석하고 환경 의존성을 분리한 공통 command를 호출한다. 모든 fetch 의존성, 파일 경로, 확인 callback을 명시적으로 주입한다. `init`, `status`, `check`는 기존 프로젝트 생성·리포트·연결 확인 함수를 사용한다.

빌드 설정과 `package.json`에 `build:cli`, `cli` 실행 경로를 추가한다. 플러그인 ZIP에 CLI 실행 파일을 섞지 않는다. CLI 실행 script가 필요하면 `scripts/`에 최소 래퍼만 둔다.

완료 기준: Obsidian이 없는 환경에서 빌드한 `dist/cli.mjs`를 subprocess로 실행해 JSON과 종료 코드를 검증한다. 문서의 `node dist/cli.mjs ...`와 `pnpm --silent run cli ...` 경로 모두에서 옵션 전달과 stdout의 단일 JSON 파싱을 검사한다. pnpm script 실행 경로는 빌드 완료 후에 검증하고 배너·빌드 로그가 섞이지 않아야 한다. 기존 설정 vault와 환경변수만 있는 신규 폴더에서 모두 실행된다.

### 4단계 실제 동기화 검증

설정된 vault 인증으로 읽기 전용 실제 Confluence smoke test를 수행한다. HTTP status, 페이지·첨부 결과 개수만 기록한다. 페이지 루트와 폴더 루트, 정상 반복 Pull, 부분 조회 실패의 파일 보호를 확인한다.

실제 Push는 사용자가 테스트용으로 지정하고 업로드를 허용한 페이지 하나에서만 수행한다. Pull → Markdown 수정 → Push → 원격 version 재조회까지 검증한다. 인증 정보가 있는 일반 문서를 자동으로 테스트 페이지로 선택하지 않는다. 기존 `smoke-push-current-page.mjs`는 원격 본문을 수정하므로 읽기 검증용으로 실행하지 않는다.

완료 기준: version 충돌·확인 누락 시 PUT이 없고, 로컬 수정 Pull에서 백업이 생성되며, 업로드 성공 후 로컬 metadata가 일치한다. 테스트 페이지 승인이 없으면 실제 Push 검증은 미완료로 명시한다.

### 5단계 플러그인 호환성과 사용 문서

Obsidian의 기존 Pull/Push, 취소 리포트, 새 공통 잠금 동작을 확인한다. README에 설치 조건, 명령 예시, 환경변수, 종료 코드, 부분 적용 복구, 잠금 복구를 기록한다. PRD의 CLI 작업 흐름과 업로드 경계를 유지한다.

`pnpm run verify`에 CLI 빌드 검증을 포함하고 `pnpm run prepare:current-vault`를 실행한다. 현재 vault 번들과 `dist/main.js`의 일치를 확인한다. 변경된 UI 안내가 있으면 옛 문구가 설치 번들에 남지 않았는지 검사한다.

플러그인 산출물이나 배포 안내가 바뀌면 `pnpm run prepare:vault` 후 별도 vault template 저장소에도 반영한다. 해당 저장소의 Git 루트를 전후 확인하고 인증·설정·문서 산출물·Pull 로그는 커밋하지 않는다. CLI의 template 동봉·전역 설치·Release 생성은 이 단계에 자동으로 포함하지 않는다.

## 최종 수용 기준

- Obsidian 프로세스와 설치 없이 CLI의 프로젝트 생성·Pull·파일 편집·단일 Push 흐름을 수행할 수 있다.
- 양쪽이 허용하는 유효한 입력에서 플러그인과 CLI의 Markdown 본문·metadata·충돌 판단·안전 삭제 정책이 같다. CLI의 추가 출처 검증은 앞서 명시한 입력 계약을 따른다.
- CLI 출력은 파싱 가능한 JSON 한 개이고 실패·부분 적용·차단을 종료 코드와 필드로 구별한다.
- 확인 없이 원격 업로드·강제 덮어쓰기를 실행하지 않으며 `--yes`로 version 검사를 우회하지 못한다.
- vault 경로 탈출과 협조적인 동기화 명령의 동시 실행을 차단한다. 실행 중 감지된 로컬 변경·새 파일 경로 충돌을 보존하고, 외부 에디터의 비협조적 동시 편집 한계를 명시한다.
- 저장·이동·리포트 실패와 원격 반영 불명 상태를 일반 무변경 실패로 축약하지 않는다. 이전 리포트를 이번 실행 결과로 오인하게 연결하지 않는다.
- 실제 API 읽기 검증과 승인된 테스트 페이지 Push 검증, 플러그인 호환 검증의 결과가 각각 남는다.
- 린트·타입 검사·전체 테스트·플러그인 빌드·CLI 빌드가 통과한다.

## 범위와 진행 원칙

제품 코드의 중심 변경은 세 command의 환경 의존성 분리·결과 반환, 하위 저장 함수의 부분 완료 정보, PUT 반영 상태 보존, 출처 검증, Node 어댑터, CLI 진입점, 공통 잠금이다. 기존 API·Markdown 변환·파일명 정책을 다시 작성하지 않는다. 필요한 안전 검증 때문에 단순 명령 래퍼만 추가하는 작업보다는 범위가 크다.

1단계부터 3단계까지 먼저 연결해 실제 실행 경로를 만든 뒤, 4단계와 5단계의 검증으로 완료를 판단한다. 날짜나 작업 시간은 확정하지 않는다. 구현, 실제 Push 테스트 대상 지정, 배포·커밋·푸시는 각각 해당 요청 범위에서 진행한다.

## 검증 기록

- 로컬 subprocess 검증은 Obsidian 런타임 없이 `init → Pull → Markdown 편집 → Push → 단일 Pull 백업`을 수행했다. Node 직접 실행과 pnpm silent 실행의 JSON·종료 코드를 확인했다.
- 폴더 루트, pagination, HTML 첨부, 출처 차단, 확인 누락, 원격 응답 유실, 리포트 기록 실패, 잠금·경로·로컬 변경 보호를 검사했다.
- 실제 vault 인증의 연결 확인 CLI는 종료 코드 `0`을 반환했다.
- 읽기 전용 실제 API smoke test: 폴더 트리 114개 페이지, 페이지 루트 1개, HTML 첨부 조회·다운로드 101개, 조회·다운로드 실패 0개. HTTP 200 응답 333건과 302 이동 101건을 확인했다. 이메일·토큰·Authorization·응답 본문을 출력하지 않았다.
- 실제 iCloud vault에서 생성한 임시 파일로 저장·안전 이동을 검증하고 임시 파일을 정리했다. 기존 문서는 수정하지 않았다.
- `pnpm run verify`의 린트·타입 검사·테스트 507개·플러그인/CLI 빌드를 통과했다.
- 현재 vault와 별도 template에 버전 0.1.63 산출물을 반영했다. 실제 Obsidian에서 재로드 후 기존 프로젝트·루트 링크·최근 리포트를 Sync Panel에 표시하는 것을 확인했다. 인증 설정을 변경하지 않았다.
- 실제 Confluence PUT 검증은 아직 수행하지 않았다. 전용 테스트 페이지가 지정되고 업로드가 허용된 뒤 실행한다.
