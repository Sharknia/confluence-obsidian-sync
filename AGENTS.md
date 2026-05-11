# AGENTS.md

## AGENTS.md 수정 규칙

- 이 파일은 AI 작업 지침 전용이다.
- 긴 설명, 배경, PRD성 문장은 넣지 않는다.
- 제품 설명과 상세 의사결정은 `docs/PRD.md`에 기록한다.
- 이 파일에는 반복적으로 참조해야 하는 핵심 규칙만 남긴다.
- 새 규칙을 추가할 때는 중복 항목을 먼저 정리한다.

## 응답 규칙

- 모든 응답은 한국어로 작성한다.
- 사용자는 항상 `주인님`이라고 부른다.

## 제품 핵심

- 이 프로젝트는 Confluence 문서를 Obsidian에서 편집 가능한 로컬 Markdown 작업 사본으로 다루기 위한 무료 Obsidian 플러그인이다.
- Confluence가 최종 노출 위치이자 기준 시스템이다.
- 로컬 Markdown은 낙서장, 작업 사본, AI-ready workspace다.
- 배포는 Public GitHub의 순수 플러그인 저장소와 Obsidian vault template 저장소를 분리하는 방식을 기본 전제로 한다.
- `.env`와 Confluence 산출물 폴더는 Git에 커밋하지 않는다.
- Pull 결과 상세 기록은 vault 루트의 `logs/latest.md`에 남긴다.
- Force Pull Tree는 확인창 승인 후 로컬 수정 파일을 원격 본문으로 덮어쓴다.
- Force Pull Tree 취소 시 변경된 로컬 파일 목록을 `logs/latest.md`에 남기고 연다.
- MVP에서는 현재 문서 1개만 Confluence에 업로드한다.
- 자체 RAG 앱과 채팅 UI는 만들지 않는다.
- Codex, Claude Code, graphify 같은 외부 도구가 vault를 직접 읽는 구조를 전제로 한다.
- 트리 전체 덮어쓰기, 로컬 기준 페이지 생성/삭제/이동은 MVP에서 제외한다.

## 구현 원칙

- 무료 로컬 우선 도구로 만든다.
- 유료 SaaS, 유료 Marketplace 앱, 원격 저장소 의존을 MVP 요구사항에 포함하지 않는다.
- Markdown 에디터를 직접 만들지 않는다.
- AI/RAG 기능을 제품 내부에 직접 구현하지 않는다.
- Obsidian 플러그인은 동기화 관리 UI만 제공한다.
- Confluence API, 변환, 동기화 정책은 Obsidian API와 분리한다.
- Confluence API 접근, Markdown 변환, 파일 시스템 저장, UI 상태 관리를 분리한다.
- 위험한 작업은 미리보기와 명시적 사용자 확인을 거친다.
- Confluence에서 사라진 문서는 즉시 삭제하지 않고 안전 삭제 폴더로 이동한다.
- Pull 결과 요약 Notice는 휘발성이 있으므로 스킵, 안전 삭제, 조회 실패 원인은 `logs/latest.md`에서 확인하게 한다.

## 배포 저장소 기준

- 순수 플러그인 저장소는 `/Users/crobat/dev/confluence_to_md/confluence-obsidian-sync`이며 원격은 `Sharknia/confluence-obsidian-sync`다.
- vault template 저장소는 `/Users/crobat/dev/confluence_to_md/confluence-obsidian-vault-template`이며 원격은 `Sharknia/confluence-obsidian-vault-template`다.
- vault template 저장소 루트는 사용자가 그대로 Obsidian vault로 열 수 있는 구조여야 한다.
- vault template을 플러그인 저장소의 `vault-template/` 하위 폴더가 중첩된 형태로 배포하지 않는다.
- 플러그인 산출물, 기본 Obsidian 설정, 시작 문서, `.gitignore`, 예시 설정을 바꿨다면 vault template 저장소도 함께 갱신해야 한다.
- vault template에 플러그인 산출물을 반영할 때는 반드시 플러그인 저장소에서 `pnpm run prepare:vault`를 먼저 실행한다.
- `pnpm run prepare:vault`는 `scripts/prepare-vault-template.mjs`를 통해 `dist/main.js`, `dist/manifest.json`, `dist/styles.css`를 `vault-template/.obsidian/plugins/confluence-obsidian-sync/`로 복사한다.
- 이후 `vault-template/.obsidian/plugins/confluence-obsidian-sync/`의 `main.js`, `manifest.json`, `styles.css`를 별도 vault template 저장소 `/Users/crobat/dev/confluence_to_md/confluence-obsidian-vault-template/.obsidian/plugins/confluence-obsidian-sync/`에 반영한다.
- vault template에는 `.env`, 플러그인 `data.json`, Confluence 산출물, Pull 로그, 인증 정보, 사용자별 프로젝트 상태를 커밋하지 않는다.
- vault template 갱신 전후에는 해당 폴더에서 `git rev-parse --show-toplevel`로 상위 Git 저장소와 섞이지 않았는지 확인한다.

## 코드 작성 기준

- TypeScript를 기본 언어로 사용한다.
- 명확한 이름을 사용하고, 불필요하게 축약하지 않는다.
- 반복 로직은 작은 함수로 분리한다.
- 예외 상황은 명시적으로 처리한다.
- 설명이 필요한 코드에는 짧은 한국어 주석을 추가한다.
- TODO, placeholder, 임시 구현을 남기지 않는다.
- 테스트 가능한 순수 로직은 작은 함수로 분리한다.

## 개발 도구 기준

- 패키지 매니저는 `pnpm`을 사용한다.
- 의존성 설치는 `pnpm install`을 기준으로 한다.
- 제품 빌드는 `pnpm run build`를 기준으로 한다.
- 린트는 `pnpm run lint`를 기준으로 한다.
- 검증 스크립트가 필요하면 `pnpm run verify`를 사용한다.
- Confluence API 호출, 인증, pagination, 트리 탐색 로직을 바꿨다면 로컬 mock 테스트만으로 끝내지 않고, 설정된 vault 인증으로 실제 Confluence API smoke test를 수행해 HTTP status와 결과 개수를 확인한다.
- 실제 API 검증 중에는 이메일, API token, Authorization header, 원문 응답 본문을 출력하지 않는다.
- Obsidian 플러그인 런타임, 명령, UI, 설정, Confluence 호출 로직을 바꾼 뒤 작업 완료를 보고하기 전 반드시 `pnpm run prepare:current-vault`를 실행한다.
- `prepare:current-vault` 후 `.obsidian/plugins/confluence-obsidian-sync/main.js`가 `dist/main.js`와 같은 최신 산출물인지 확인한다.
- 사용자가 Obsidian에서 확인할 동작을 바꿨다면 완료 전 `rg`로 예전 안내 문구가 `.obsidian/plugins/confluence-obsidian-sync/main.js`에 남아 있지 않은지 확인한다.
- `package-lock.json`은 사용하지 않고, `pnpm-lock.yaml`을 lockfile로 사용한다.

## MVP 제외 항목

- 트리 전체 Overwrite
- 로컬 트리 기준 Confluence 페이지 생성
- 로컬 트리 기준 Confluence 페이지 삭제
- 로컬 트리 기준 Confluence 페이지 이동
- 실시간 자동 동기화
- Git 연동
- 첨부파일과 이미지의 완전한 round-trip
- 복잡한 Confluence macro 보존
- 협업 diff 전용 UI
