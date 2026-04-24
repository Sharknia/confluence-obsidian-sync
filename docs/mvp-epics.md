# MVP 에픽 리스트

## 목적

이 문서는 Confluence Obsidian Sync MVP 완성까지 필요한 에픽을 정의한다.

MVP의 우선순위는 실제 Confluence Cloud 루트 페이지와 하위 트리를 Obsidian vault 안의 로컬 Markdown 작업 사본으로 내려받고, 현재 Markdown 문서 1개를 다시 기존 Confluence 페이지에 안전하게 업로드하는 것이다.

## 우선순위 기준

- 실제 Confluence 루트 트리 Pull을 첫 번째 기술 데모 목표로 삼는다.
- Confluence는 공식 원본이고, 로컬 Markdown은 작업 사본이다.
- Obsidian 플러그인은 동기화 관리 UI만 제공한다.
- 자체 Markdown 에디터, 자체 AI/RAG UI, 실시간 자동 동기화는 MVP 범위에서 제외한다.
- 데이터 손실 가능성이 있는 작업은 충돌 확인과 안전 장치를 우선한다.

## Epic 1. 프로젝트 뼈대와 Obsidian 플러그인 기반 구축

### 목표

Obsidian에서 로드 가능한 최소 플러그인 프로젝트를 만든다.

### 완료 기준

- TypeScript 기반 Obsidian 플러그인을 빌드할 수 있다.
- `pnpm run build`와 `pnpm run lint`가 구성되어 있다.
- Obsidian vault template 안에서 플러그인을 로드할 수 있다.
- 명령 팔레트에 기본 명령이 등록되어 있다.
- 설정 화면에 진입할 수 있다.

### 구현 계획

- [Obsidian Plugin Foundation Implementation Plan](superpowers/plans/2026-04-23-obsidian-plugin-foundation.md)

## Epic 2. Confluence Cloud 연결 설정

### 목표

`https://selta.atlassian.net` Confluence Cloud에 API로 접근할 수 있게 한다.

### 완료 기준

- Confluence base URL, 이메일, API token을 설정할 수 있다.
- 저장된 인증 정보로 Confluence API 접근 여부를 검증할 수 있다.
- 인증 실패, 권한 없음, 네트워크 오류를 구분해서 표시한다.
- 민감 정보는 Git 커밋 대상에서 제외한다.
- 설정값 없이 Pull을 실행하면 명확한 안내를 표시한다.

### 구현 계획

- [Confluence Cloud Connection Implementation Plan](superpowers/plans/2026-04-23-confluence-cloud-connection.md)

## Epic 3. 루트 페이지 기반 프로젝트 생성

### 목표

사용자가 Confluence 루트 페이지 URL을 입력하면 로컬 프로젝트 설정을 생성한다.

### 완료 기준

- Confluence URL에서 pageId를 추출한다.
- 루트 페이지 메타데이터를 조회한다.
- 프로젝트 이름, spaceId, rootPageId, rootUrl을 저장한다.
- 로컬 저장 폴더를 생성한다.
- 프로젝트 manifest를 생성한다.

### 구현 계획

- [Root Page Project Creation Implementation Plan](superpowers/plans/2026-04-23-root-page-project-creation.md)

## Epic 4. 실제 Confluence 페이지 트리 Pull

### 목표

루트 페이지와 하위 문서 트리를 실제 Confluence에서 내려받는다.

### 완료 기준

- 루트 페이지 기준 descendants를 조회한다.
- 페이지 계층 구조를 보존한다.
- 각 페이지의 제목, ID, parent ID, version, source URL을 수집한다.
- API pagination을 처리한다.
- 일부 페이지 조회가 실패해도 전체 작업을 무조건 중단하지 않고 오류 목록을 남긴다.

## Epic 5. Confluence 본문을 Markdown 파일로 저장

### 목표

내려받은 페이지를 Obsidian에서 편집 가능한 Markdown 파일로 만든다.

### 완료 기준

- 페이지 1개를 Markdown 파일 1개로 저장한다.
- frontmatter에 Confluence 메타데이터를 기록한다.
- 제목, 문단, 링크, 리스트, 코드 블록, 기본 표를 Markdown으로 변환한다.
- 파일명으로 쓸 수 없는 문자를 정리한다.
- 동일 제목 충돌을 처리한다.
- 변환 손실 가능성이 있는 macro는 명확히 표시한다.

## Epic 6. Pull 동기화 정책과 안전 삭제

### 목표

반복 Pull 시 로컬 파일을 안전하게 갱신한다.

### 완료 기준

- 기존 파일을 갱신한다.
- 새 페이지를 추가한다.
- Confluence에서 사라진 페이지는 삭제하지 않고 안전 삭제 폴더로 이동한다.
- 로컬에서 수정된 파일을 무조건 덮어쓰지 않도록 정책을 적용한다.
- Pull 결과 요약을 제공한다.

## Epic 7. Sync Panel MVP

### 목표

사용자가 현재 프로젝트 상태와 동기화 작업을 이해할 수 있게 한다.

### 완료 기준

- 현재 프로젝트를 표시한다.
- 루트 페이지 링크를 표시한다.
- 마지막 Pull 시각을 표시한다.
- Pull Tree 버튼을 제공한다.
- Push Current Page 버튼을 제공한다.
- 최근 오류를 표시한다.
- 복잡한 diff UI는 제외한다.

## Epic 8. 현재 Markdown 문서 Push

### 목표

현재 열려 있는 Markdown 파일 1개를 기존 Confluence 페이지에 업로드한다.

### 완료 기준

- frontmatter에서 pageId와 version을 읽는다.
- 원격 최신 version을 조회한다.
- version이 일치하지 않으면 업로드를 차단한다.
- Markdown을 Confluence가 받을 수 있는 형식으로 변환한다.
- 기존 페이지 본문을 갱신한다.
- 성공 시 로컬 frontmatter의 version을 갱신한다.

## Epic 9. 오류 처리와 사용자 보호 장치

### 목표

데이터 손실 가능성을 줄이고 실패 원인을 사용자가 이해하게 한다.

### 완료 기준

- 인증 실패를 안내한다.
- 권한 없는 페이지를 안내한다.
- rate limit 또는 API 실패를 안내한다.
- 변환 실패 페이지 목록을 제공한다.
- Push 충돌을 차단한다.
- 위험한 작업 전 명시적 확인을 거친다.

## Epic 10. Vault Template 사내 배포 패키징

### 목표

사내 Git 저장소로 배포 가능한 형태를 만든다.

### 완료 기준

- `.obsidian/plugins/confluence-obsidian-sync/` 산출물 구성을 제공한다.
- `.confluence-sync/` 예시 설정을 제공한다.
- `confluence/` 산출물 폴더를 Git에서 제외한다.
- `.env` 또는 인증 정보를 Git에서 제외한다.
- 사용자가 clone 후 Obsidian vault로 열면 바로 시작할 수 있다.

## Epic 11. MVP 문서화

### 목표

사용자가 설치와 사용 흐름을 따라갈 수 있게 한다.

### 완료 기준

- 설치 가이드를 제공한다.
- API token 발급 가이드를 제공한다.
- 첫 프로젝트 생성 가이드를 제공한다.
- Pull Tree 사용법을 제공한다.
- Push Current Page 사용법을 제공한다.
- 알려진 변환 한계를 문서화한다.
- 문제 발생 시 확인할 체크리스트를 제공한다.

## 마일스톤 제안

### Milestone 1. 실제 Pull 기술 데모

Epic 1부터 Epic 5까지 완료한다.

사용자는 실제 Confluence 루트 페이지 URL을 입력하고, 루트 페이지와 하위 문서가 로컬 Markdown 파일로 생성되는 것을 확인할 수 있다.

### Milestone 2. 안전한 반복 Pull

Epic 6을 완료한다.

사용자는 같은 프로젝트에서 Pull을 반복 실행해도 삭제와 덮어쓰기 위험을 통제할 수 있다.

### Milestone 3. Obsidian MVP 사용 흐름

Epic 7과 Epic 8을 완료한다.

사용자는 Sync Panel에서 Pull 상태를 확인하고, 현재 Markdown 문서 1개를 기존 Confluence 페이지에 업로드할 수 있다.

### Milestone 4. 사내 배포 가능 MVP

Epic 9부터 Epic 11까지 완료한다.

사용자는 사내 Git 저장소에서 vault template을 clone하고, Obsidian에서 열어 MVP 기능을 사용할 수 있다.
