# Vault CLI 전역 설치 배포 작업계획서

작성일: 2026-10-06

상태: Astra xhigh 리뷰 반영 후 `0.1.64` 구현·macOS/Linux/Windows 검증 완료.

## 목표와 사용자 흐름

사용자가 기존 방식으로 vault template을 ZIP 또는 Git clone으로 받은 뒤, vault 폴더에서 설치 명령 한 줄을 실행하면 전역 명령 `confluence-sync`를 사용할 수 있게 한다. 다른 사용자에게 코드 저장소 clone·TypeScript 빌드·개인 shell 함수 작성을 요구하지 않는다.

빌드한 CLI를 로컬 npm 설치 패키지로 만들어 vault에 동봉한다. npm 공개 등록·발행 계정·새 저장소·모노레포 도구는 추가하지 않는다. 개발은 기존 pnpm을 유지하고, 사용자 설치에는 Node에 함께 제공되는 npm을 사용한다.

README의 기본 설치 명령은 다음과 같다.

```bash
npm install --global --engine-strict ./cli/confluence-sync-cli.tgz
confluence-sync --version
```

전역 설치는 실행 파일의 사용 범위다. 설치한 vault를 사용자 전역의 기본 대상으로 저장하지 않는다. 실행할 때 기존 `--vault` 절대 경로를 명시하며 여러 vault에서 같은 명령을 사용할 수 있다.

```bash
confluence-sync check --vault '/내/vault'
confluence-sync pull-tree --vault '/내/vault'
```

## 설치 명령의 전제와 범위

첫 배포는 Node.js 22 이상, npm, 사용자 전용으로 구성된 현재 Node/npm의 global prefix와 그 실행 경로의 PATH 등록을 전제로 한다. `--engine-strict`로 지원하지 않는 Node 버전의 설치를 실패시킨다. Node가 없는 새 OS에서도 한 명령으로 모두 준비된다고 안내하지 않는다.

- `npm prefix --global`로 설치 위치를 확인한다. 사용자 전용 경로여야 하며, macOS·Linux 실행 경로는 `<prefix>/bin`, Windows는 `<prefix>`다. 공유 경로의 쓰기 권한만으로 사용자 전용 설치를 보장하지 않는다.
- Node·npm이 없으면 설치 전제 조건과 공식 설치 안내를 제공한다.
- 전역 경로의 권한 오류가 나면 사용자 범위의 Node/npm 환경을 준비하도록 안내한다. 기본 해결책으로 `sudo`, 광범위한 `chmod`나 `--force`를 제시하지 않는다.
- 설치는 성공했지만 명령을 찾지 못하면 npm 전역 실행 경로와 PATH 확인·새 터미널 실행을 안내한다.
- 설치 과정에서 사용자의 shell 설정, npm 전역 prefix, 다른 전역 프로그램을 임의로 변경하는 자동 설치 스크립트는 만들지 않는다.
- Node 버전 관리자에서 사용하는 runtime을 바꾸면 전역 설치 위치도 달라질 수 있다. 이 경우 받은 패키지로 다시 설치하는 방법을 안내한다.

macOS·Linux·Windows의 실제 설치와 명령 실행을 검증한다. 검증하지 못한 OS는 지원 확인 전으로 남긴다. OS별 단독 바이너리와 Node 자동 설치는 후속 범위다.

## 현재 구현과 필요한 변경

| 현재 코드·배포 상태 | 필요한 변경 |
| --- | --- |
| `dist/cli.mjs`는 단일 Node 번들 | 기존 번들을 재사용해 설치용 패키지 구성 |
| 코드 저장소 `package.json`은 플러그인 개발용이며 `private: true` | 개발 패키지는 유지하고 배포용 manifest만 별도 생성 |
| `esbuild.cli.config.mjs`에 실행용 shebang·권한 설정이 없음 | 전역 executable로 실행 가능한 엔트리·파일 권한 보장 |
| `src/cli/main.ts`는 `import.meta.url`과 argv 파일 URL을 직접 비교 | npm의 Unix symlink와 Windows shim에서도 실제 엔트리를 식별하도록 보완 |
| `scripts/prepare-vault-template.mjs`는 플러그인 세 파일만 복사 | CLI 설치 패키지도 별도 template 저장소 루트의 `cli/`에 반영 |
| README는 개발 저장소에서 빌드·실행하는 흐름 | 일반 사용자용 vault 설치 흐름과 개발자용 빌드 흐름을 구분 |

API·Markdown 변환·동기화 정책과 JSON/종료 코드 계약은 변경하지 않는다. 기존 CLI 코드의 재사용과 설치·패키징만 다룬다.

## 배포물 구성과 버전

```text
vault-root/
  .obsidian/plugins/confluence-obsidian-sync/
    main.js
    manifest.json
    styles.css
  cli/
    confluence-sync-cli.tgz
  README.md
  처음 시작하기.md
  template.json
```

`.tgz` 내부에는 npm 형식의 `package/` 폴더와 다음 파일만 포함한다.

- 생성한 `package.json`
- 빌드한 `cli.mjs`
- 배포용 README
- 기존 MIT 선언과 번들 의존성에 맞는 라이선스 고지

배포용 manifest의 기준은 다음과 같다.

| 필드 | 계약 |
| --- | --- |
| `name` | `confluence-obsidian-sync-cli` |
| `version` | 소스 저장소의 `package.json` 버전에서 가져옴 |
| `private` | `true`. 공개 npm 발행 없이 로컬 패키지로 설치 |
| `type` | `module` |
| `bin` | `confluence-sync` → `cli.mjs` |
| `engines.node` | `>=22` |
| `files` | 실행 번들·README·라이선스 고지의 명시적 목록 |

CLI 번들은 현재처럼 의존성을 포함하므로 설치 패키지에 별도 runtime 의존성이나 설치 시 빌드·다운로드 스크립트를 넣지 않는다. 사용자의 인증·프로젝트 상태·문서·로그·shell 설정은 패키지에 포함하지 않는다.

template의 파일명은 `confluence-sync-cli.tgz`로 고정해 버전마다 설치 명령을 바꾸지 않는다. 실제 버전은 패키지 manifest와 `confluence-sync --version`으로 확인한다. root 개발 패키지·플러그인 manifest·CLI manifest의 제품 버전을 일치시킨다. 이번 구현에서 제품 버전을 `0.1.63`에서 `0.1.64`로 패치 하나 올렸다.

## 빌드와 template 반영

기존 `pnpm run build:cli`를 재사용한다. `scripts/`에 배포용 manifest·README를 준비하고 pnpm의 표준 pack 기능으로 `.tgz`를 만드는 최소 스크립트를 추가한다. tar 포맷과 npm 설치기를 직접 구현하지 않는다.

`dist/` 아래의 패키징 임시 폴더에서 파일 목록을 고정한 뒤 pack한다. 코드 저장소 전체를 pack 대상으로 삼지 않는다. `pnpm run package:cli`를 추가하고, `prepare:vault`가 최신 CLI 패키지를 생성한 뒤 template에 반영하도록 연결한다.

다음 기존 산출물 계약은 유지한다.

- 개발용 직접 실행: `node dist/cli.mjs ...`, `pnpm --silent run cli ...`
- 플러그인 ZIP: `main.js`, `manifest.json`, `styles.css` 세 파일
- vault template: 루트를 그대로 vault로 열 수 있는 별도 저장소

worktree에서는 `VAULT_TEMPLATE_ROOT=/별도/template/저장소 pnpm run prepare:vault`로 실제 대상 경로를 명시한다. template 반영 전후에 `git rev-parse --show-toplevel`을 확인한다. `cli/confluence-sync-cli.tgz`의 해당 배포 파일만 교체하며, 사용자 vault의 설정이나 문서 폴더를 정리 대상으로 삼지 않는다. `template.json`에는 CLI 버전을 별도 필드로 기록하고 플러그인 버전과의 일치를 검증한다.

## 업데이트와 제거 계약

새 vault 배포에서 받은 `.tgz`에 같은 설치 명령을 실행하면 전역 CLI를 해당 패키지 버전으로 교체한다. 자동 업데이트·npm registry 조회·기존 vault의 자동 다운로드는 추가하지 않는다. 이전 버전의 패키지를 명시적으로 설치하면 그 버전이 설치될 수 있으므로 설치 후 버전을 확인하게 안내한다.

```bash
npm install --global --engine-strict ./cli/confluence-sync-cli.tgz
confluence-sync --version
npm uninstall --global confluence-obsidian-sync-cli
```

제거는 전역 프로그램만 제거한다. vault의 인증·manifest·Markdown·백업·Pull 로그는 유지한다. `--force`로 다른 패키지의 동일한 명령 이름을 덮어쓰지 않는다. 이름 충돌은 설치 실패로 안내한다.

## 단계별 작업과 완료 기준

### 1단계 전역 실행 엔트리 보완

shebang과 실행 권한을 보장하고 실제 파일 경로를 기준으로 엔트리를 식별한다. 다른 모듈에서 import했을 때 자동 실행하지 않는 기존 조건도 유지한다. `--help`도 소비자용 `confluence-sync <명령> --vault <절대 경로>` 안내로 바꾸고 내용을 검증한다.

완료 기준: 직접 Node 실행, 실행 파일 직접 호출, Unix symlink 경로, Windows npm shim에서 `--help`·`--version`이 JSON을 반환한다. 기존 직접 실행과 전체 CLI 회귀 테스트가 통과한다.

### 2단계 설치 패키지 생성

생성 manifest·번들·사용 안내·고지를 허용 목록으로 묶고 `package:cli`를 연결한다. 제품 버전의 단일 기준과 Node 최소 버전을 반영한다.

완료 기준: 압축을 풀어 실제 파일 목록·버전·bin·shebang을 검사한다. 개발 의존성, 개인 경로, 실제 인증 파일·토큰·Confluence 산출물이 들어가지 않는다. runtime 의존성이나 lifecycle 스크립트 없이 설치할 수 있다.

### 3단계 다른 사용자 환경의 설치 검증

임시 npm prefix·cache·사용자/전역 설정 파일로 설치한다. 개발자의 기존 전역 환경에 링크해서 통과시키지 않는다. 사용자 설치 테스트에만 npm을 사용하며 코드 저장소 의존성 관리는 계속 pnpm으로 한다.

완료 기준:

- vault ZIP을 임시 폴더에 풀고 README의 설치 명령을 그대로 실행한다.
- 코드 저장소와 `node_modules`, Obsidian 없이 패키지 하나로 명령이 실행된다.
- 설치 후 원본 vault·패키징 폴더를 이동하거나 제거하고 다른 작업 폴더에서도 `confluence-sync --version`을 실행한다.
- Node 22 이상에서 성공하고 지원하지 않는 Node에서는 engine-strict 설치가 실패한다.
- 공백·한국어 경로, 전역 prefix 권한 부족, PATH 미등록, 명령 이름 충돌을 검사한다.
- 서로 다른 두 vault를 `--vault`로 선택하며 한 vault를 전역 기본값으로 저장하지 않는다.
- 로컬 API 서버로 전역 명령의 `init → Pull → 편집 → Push`를 검증하고 JSON·종료 코드를 유지한다.
- 재설치·버전 교체·제거 후 vault 데이터와 관계없는 전역 패키지가 유지된다.

설치 패키지의 필수 내용이 로컬에 모두 포함돼 있는지 네트워크를 차단한 설치·실행으로 확인한다. npm의 부가 기능이 registry를 조회하는 경우 테스트에서 이를 끄되 일반 사용자 설치에 추가 프로그램 다운로드를 요구하지 않는다.

### 4단계 두 저장소의 안내와 배포 반영

플러그인 README·PRD와 template의 README·시작 문서를 갱신한다. 소비자 안내에는 설치 전제, vault에서 실행할 한 줄, 전역 명령 예시, 인증 재사용, 권한·PATH 문제, 업데이트·제거를 기록한다. 코드 clone·빌드는 개발자 안내에만 남긴다.

`prepare:vault`를 통해 설치 패키지·플러그인 산출물을 같은 버전으로 반영하고 template 루트·압축 구조를 검증한다. 기존 vault 수동 설치와 플러그인 ZIP 사용법은 유지한다.

완료 기준: 사용자 안내에 특정 개인 경로·shell 함수·레포 경로가 없다. 설명만 읽은 별도 사용자 환경에서 설치·버전 확인·연결 확인까지 진행한다. 인증이 없는 새 vault의 환경변수 시작 방법도 일치한다.

### 5단계 최종 검증과 기록

`pnpm run verify`와 설치 패키지 검증을 수행한다. 플러그인 런타임이 바뀌면 기존 지침에 따라 `prepare:current-vault`와 최신 번들 일치·옛 안내 문구 검사를 수행한다. 실제 API 호출 로직을 변경하지 않았다면 포장 방식 변경만을 이유로 업무 문서에 쓰기 smoke test를 실행하지 않는다.

최종 기록에는 제품·설치 패키지 버전, 압축 내용 검사, OS별 설치 결과, 재설치·제거·vault 이동 결과를 남긴다. 기존 실제 Confluence Push 미검증 상태를 이번 설치 검증으로 해결했다고 표시하지 않는다. npm 공개 발행·Release 생성·커밋·푸시는 해당 작업 요청 범위에서 진행한다.

## 완료 판단

정상 전제 환경에서 사용자는 vault 다운로드 후 설치 명령 한 줄로 전역 CLI를 사용한다. 프로그램은 vault와 독립적으로 설치되며 vault 데이터는 실행 시에만 읽는다. 조건이 준비되지 않은 환경은 원인을 구별해 안내하고 관리자 권한이나 설정 변경으로 조용히 우회하지 않는다.

이 단계는 기존 동기화 엔진을 확장하는 작업이 아니라 vault 배포에 CLI 설치물을 더하는 작업이다. API·변환·인증 저장 방식·동기화 정책·전역 기본 vault·새 서버는 추가하지 않는다.

## 참고

로컬 tarball과 전역 설치는 [npm install 공식 문서](https://docs.npmjs.com/cli/v11/commands/npm-install/), 명령 등록과 engine 필드는 [package.json 공식 문서](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)를 따른다. 실제 설치 동작은 지원 대상으로 정한 Node/npm 환경에서 확인한다.

## 리뷰 반영

Astra xhigh의 P2 두 건과 P3 한 건을 반영했다. npm prefix는 쓰기 권한만으로 판단하지 않고 사용자 전용 경로와 OS별 PATH를 명시한다. `--help`를 전역 명령 기준으로 변경하고 실제 설치 테스트에서 확인한다. worktree의 template 갱신은 `VAULT_TEMPLATE_ROOT`를 명시한다. 새 사용자 선택 사항은 없다.

## 2026-10-06 검증 기록

- `pnpm run verify`: 린트·타입 검사·510개 테스트·플러그인/CLI 빌드 통과.
- macOS arm64 Node 24.18.0 및 Node 22.14.0: 임시 npm prefix에 오프라인 설치 후 전역 명령으로 CLI 통합 테스트 16개 통과. 개발 저장소 외부 작업 폴더에서 실행했다.
- 원본 배포 폴더 이동 후 실행, 공백·한국어 경로, 사용자 설정 파일 분리, PATH 누락, prefix 권한 부족, 명령 이름 충돌, 0.1.0 fixture에서 0.1.64로 교체·재설치·제거를 확인했다. 제거 후 vault 문서와 관계없는 명령 파일은 유지됐다.
- 전역 명령으로 서로 다른 vault를 선택했다. `--vault` 누락 시 실패하고 새 vault에 전역 기본값을 저장하지 않았다.
- 허용된 압축 내용은 package.json·cli.mjs·README.md·LICENSE·THIRD-PARTY-NOTICES.txt 다섯 파일이다. runtime 의존성과 lifecycle script는 없다. ISC·MIT·BSD-2-Clause 고지를 포함했다. 배포 원본에 LICENSE가 없는 boolbase@1.0.0은 upstream 고지를 저장해 포함했다.
- Node 20.19.0: 실제 npm `--engine-strict` 설치가 EBADENGINE으로 실패했다.
- Node 22.14.0에 설치한 전역 명령의 실제 vault `check`가 종료 코드 0·connected를 반환했다. API 쓰기 동작은 로컬 HTTP 서버로만 검증했으며 실제 Confluence Push 미검증 상태는 유지한다.
- `prepare:current-vault` 실행 후 main.js가 dist 산출물과 일치했다. `prepare:vault`에서 실제 template 경로를 명시해 플러그인·CLI 패키지·template.json 버전 0.1.64를 반영했다.
- 별도 template 저장소의 커밋을 실제 vault ZIP으로 만들고, 압축 해제한 폴더에서 README 설치 명령을 그대로 실행했다. ZIP의 루트 vault 구조와 CLI 0.1.64를 확인하고 배포 폴더를 이동한 후 다른 작업 폴더에서 전역 명령을 실행했다.
- [GitHub Actions 검증](https://github.com/Sharknia/confluence-obsidian-sync/actions/runs/37435563770): macOS·Linux·Windows × Node 22·24의 6개 설치 작업과 Node 20 engine-strict 거부 검사 모두 통과했다. Windows 테스트는 대소문자가 다른 기존 npm 설정도 제거해 prefix를 격리했고, 기본 tar의 한글 인자 제한은 ASCII 파일명으로 내용 검사를 수행해 해결했다. 설치·실행의 prefix와 vault 경로에는 공백·한글을 유지했다.
