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
- 사내 배포는 Git으로 배포되는 Obsidian vault template을 기본 전제로 한다.
- `.env`와 Confluence 산출물 폴더는 Git에 커밋하지 않는다.
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
- Obsidian에서 UI 테스트를 안내하기 전 `pnpm run prepare:current-vault`를 실행하고 `.obsidian/plugins/confluence-obsidian-sync/main.js`에 최신 UI 문자열이 반영됐는지 확인한다.
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
