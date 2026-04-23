# Confluence Local Workspace PRD

## 1. 개요

Confluence Local Workspace는 특정 Confluence 페이지와 그 하위 문서 트리를 Obsidian vault 안의 로컬 Markdown 폴더 구조로 가져오고, Obsidian에서 편집한 단일 Markdown 문서를 다시 Confluence에 업로드하는 무료 로컬 우선 도구다.

이 제품에서 Confluence는 최종 노출 위치이자 기준 시스템이다. 로컬 Markdown은 사용자의 낙서장, 작업 사본, AI-ready workspace 역할을 한다. 사용자는 Obsidian에서 문서를 편집하고, 같은 vault 폴더를 Codex, Claude Code, graphify 같은 외부 도구로 열어 질문, 분석, 초안 수정을 수행할 수 있다.

제품은 자체 Markdown 에디터나 자체 RAG/채팅 UI를 만들지 않는다. 대신 Confluence 문서를 로컬 Markdown workspace로 변환하고, 기존 로컬 도구들이 그 workspace를 직접 다룰 수 있게 만드는 데 집중한다.

## 2. 문제 정의

Confluence는 팀 공유와 최종 문서 노출에는 적합하지만, 긴 문서를 빠르게 편집하거나 여러 문서를 로컬에서 정리하기에는 불편하다. 반대로 Obsidian은 Markdown 기반 편집 경험과 로컬 파일 관리에 강하지만, 팀의 공식 문서 노출처가 되기는 어렵다.

사용자는 Confluence 문서를 Obsidian에서 편하게 수정하되, 최종 결과는 Confluence에 남기고 싶다. 또한 특정 Confluence 루트 페이지를 프로젝트 단위로 관리하고, 그 하위 트리를 로컬 폴더 구조로 내려받아 문서 맥락을 유지하고 싶다.

최근 로컬 AI 도구 사용 흐름에서는 문서가 애플리케이션 내부 데이터베이스에 갇혀 있는 것보다, 파일 시스템의 Markdown workspace로 존재하는 편이 더 유리하다. Codex나 Claude Code는 같은 폴더를 열어 문서를 읽고 수정할 수 있고, graphify 같은 도구는 Markdown 산출물을 분석해 지식 그래프와 리포트를 만들 수 있다.

## 3. 목표

- Confluence 루트 페이지 링크로 로컬 프로젝트를 생성한다.
- 루트 페이지와 하위 문서 트리를 Obsidian vault 안의 폴더/Markdown 구조로 가져온다.
- Confluence 페이지 1개를 Markdown 파일 1개로 저장한다.
- 각 Markdown 파일에 Confluence 페이지 식별자와 동기화 메타데이터를 저장한다.
- Obsidian에서 수정한 현재 Markdown 문서 1개를 기존 Confluence 페이지에 업로드한다.
- 업로드 전 Confluence 최신 version을 확인해 충돌 가능성을 차단한다.
- Confluence에서 사라진 문서는 로컬에서 즉시 삭제하지 않고 안전 삭제 폴더로 이동한다.
- 무료로 사용할 수 있는 로컬 우선 도구로 제공한다.
- 사내 배포는 Git으로 배포되는 Obsidian vault template을 기본 방식으로 삼는다.
- Codex, Claude Code, graphify 같은 외부 도구가 읽기 쉬운 AI-ready local workspace를 제공한다.

## 4. 비목표

- MVP에서 트리 전체 Overwrite를 제공하지 않는다.
- MVP에서 로컬 트리 기준 Confluence 페이지 생성, 삭제, 이동을 제공하지 않는다.
- 실시간 자동 동기화를 제공하지 않는다.
- Git 연동을 제공하지 않는다.
- 첨부파일, 이미지, 복잡한 Confluence macro의 완전한 round-trip을 보장하지 않는다.
- 별도 Markdown 에디터를 직접 개발하지 않는다.
- 별도 RAG 앱이나 채팅 UI를 직접 개발하지 않는다.
- 벡터 DB를 MVP에 포함하지 않는다.
- 유료 SaaS나 유료 Marketplace 앱에 의존하지 않는다.
- 사내 배포를 위해 Obsidian Community Plugin Store나 VS Code Marketplace에 출시하지 않는다.

## 5. 핵심 사용자 시나리오

### 5.1 프로젝트 생성

사용자는 Obsidian에서 명령 팔레트나 플러그인 패널을 열고 Confluence 루트 페이지 링크를 입력한다. 플러그인은 해당 링크에서 루트 페이지 정보를 읽고 프로젝트 설정을 생성한다.

프로젝트에는 다음 정보가 저장된다.

- 프로젝트 이름
- Confluence base URL
- spaceId
- rootPageId
- rootUrl
- localRootFolder
- lastPulledAt

### 5.2 Pull Tree

사용자는 프로젝트 기준으로 `Pull Tree`를 실행한다. 플러그인은 Confluence 루트 페이지와 모든 하위 페이지를 조회하고, Obsidian vault 안에 동일한 계층의 폴더와 Markdown 파일을 생성하거나 갱신한다.

Confluence에서 사라진 것으로 판단된 로컬 문서는 즉시 삭제하지 않고 안전 삭제 폴더로 이동한다.

### 5.3 Obsidian 편집

사용자는 생성된 Markdown 파일을 Obsidian에서 자유롭게 편집한다. 로컬 Markdown은 공식 원본이 아니라 작업 사본이다.

### 5.4 Push Current Page

사용자는 현재 열려 있는 Markdown 문서만 Confluence에 업로드한다. 플러그인은 파일 frontmatter의 pageId와 version을 확인하고, Confluence에서 최신 version을 조회한다.

Confluence version이 마지막 pull 또는 마지막 push 시점의 version과 다르면 업로드를 차단하고 사용자에게 다시 Pull Tree를 실행하거나 수동으로 충돌을 정리하라고 안내한다.

### 5.5 AI 도구로 vault 열기

사용자는 Obsidian vault 폴더를 Codex나 Claude Code 같은 AI coding assistant로 연다. AI 도구는 `confluence/` 폴더의 Markdown 파일과 필요한 경우 graphify 산출물을 읽고 질문에 답하거나 초안을 수정한다.

제품은 AI 채팅 UI를 제공하지 않는다. AI 도구 선택과 사용 방식은 사용자에게 맡긴다.

### 5.6 graphify로 문서 그래프 생성

사용자는 필요할 때 `confluence/` 폴더를 대상으로 graphify를 실행한다. graphify 산출물은 `graphify-out/` 폴더에 저장한다.

생성된 `GRAPH_REPORT.md`, `graph.html`, `graph.json`은 문서 구조 파악과 AI 도구 질의 보조 자료로 사용할 수 있다.

## 6. UI/UX 요구사항

### 6.1 Settings

설정 화면에서는 다음 값을 관리한다.

- Confluence base URL
- 인증 정보
- 기본 프로젝트 저장 폴더
- 안전 삭제 폴더
- Markdown 파일명 규칙

인증 정보는 가능한 경우 Obsidian의 secret storage를 사용한다.

### 6.2 Ribbon Icon

Ribbon 아이콘은 플러그인 메인 패널을 여는 진입점이다.

### 6.3 Command Palette

MVP에서 제공할 명령은 다음과 같다.

- Create Confluence Project
- Pull Tree
- Push Current Page
- Open Sync Panel

### 6.4 Sync Panel

Sync Panel은 프로젝트 상태를 보여주는 메인 UI다.

표시 정보는 다음과 같다.

- 현재 프로젝트
- 루트 Confluence 페이지
- 마지막 Pull 시각
- 변경 후보 파일
- 충돌 파일
- 안전 삭제로 이동된 파일
- 최근 오류

MVP에서는 복잡한 diff UI를 만들지 않고, 상태와 실행 버튼 중심으로 구성한다.

### 6.5 AI-ready workspace 안내

UI와 README는 vault가 다음 용도로 사용될 수 있음을 명확히 안내한다.

- Obsidian Markdown 편집 공간
- Confluence 문서 작업 사본
- Codex 또는 Claude Code가 열 수 있는 로컬 workspace
- graphify가 분석할 수 있는 Markdown corpus

단, MVP 플러그인 UI에서 AI 채팅 기능은 제공하지 않는다.

## 7. 데이터 모델

### 7.1 Project Manifest

프로젝트별 manifest 파일은 로컬 프로젝트 루트에 저장한다.

필수 필드는 다음과 같다.

- projectName
- confluenceBaseUrl
- spaceId
- rootPageId
- rootUrl
- localRootFolder
- lastPulledAt

### 7.2 Markdown Frontmatter

각 Markdown 파일은 Confluence 페이지와 연결하기 위한 frontmatter를 가진다.

필수 필드는 다음과 같다.

- confluencePageId
- confluenceSpaceId
- confluenceParentId
- confluenceVersion
- confluenceSourceUrl
- confluenceLastPulledAt
- confluenceLastPushedAt

## 8. 변환 정책

### 8.1 Confluence to Markdown

Pull Tree에서는 Confluence 페이지 본문을 Markdown으로 변환한다. MVP에서는 제목, 문단, 링크, 리스트, 코드 블록, 표의 기본 변환을 우선 지원한다.

복잡한 macro, 첨부파일, 이미지, 특수 레이아웃은 손실 가능성을 명확히 안내한다.

### 8.2 Markdown to Confluence

Push Current Page에서는 Markdown을 Atlassian Document Format으로 변환한 뒤 Confluence API로 기존 페이지 본문을 갱신한다.

Markdown to ADF 변환은 무료 오픈소스 도구인 marklassian 또는 동등한 라이브러리 사용을 우선 검토한다.

## 9. 삭제 정책

MVP의 삭제 정책은 안전 삭제다.

Pull Tree 실행 시 Confluence 트리에서 더 이상 발견되지 않는 로컬 파일은 즉시 삭제하지 않는다. 대신 프로젝트 내부 안전 삭제 폴더로 이동한다.

안전 삭제 폴더 예시는 다음과 같다.

```text
.confluence-sync/trash/
```

권한 문제, 페이지 이동, API 오류로 인해 문서가 일시적으로 보이지 않을 수 있으므로, 로컬 파일을 즉시 제거하지 않는다.

## 10. 충돌 정책

Push Current Page 실행 전 다음 조건을 확인한다.

- Markdown frontmatter에 confluencePageId가 있는지 확인한다.
- Confluence에서 현재 page version을 조회한다.
- 로컬에 기록된 version과 원격 version이 같은지 확인한다.

원격 version이 더 높으면 업로드를 차단한다. 사용자는 Pull Tree를 다시 실행하거나 로컬 Markdown을 수동으로 정리해야 한다.

## 11. 성공 기준

MVP는 다음 조건을 만족하면 성공으로 본다.

- 사용자가 Confluence 루트 링크로 프로젝트를 생성할 수 있다.
- 루트 페이지와 하위 문서가 Obsidian vault 폴더/Markdown 구조로 저장된다.
- 각 Markdown 파일에 Confluence 메타데이터가 포함된다.
- 사용자가 현재 Markdown 문서 하나를 Confluence에 업로드할 수 있다.
- 원격 version 충돌 시 업로드가 차단된다.
- 원격에서 사라진 문서는 로컬 안전 삭제 폴더로 이동한다.
- 유료 서비스 없이 로컬 Obsidian 플러그인만으로 동작한다.
- 사용자가 사내 Git 저장소를 clone한 뒤 Obsidian에서 vault로 열어 사용할 수 있다.
- 사용자가 같은 vault 폴더를 Codex나 Claude Code로 열어 Confluence Markdown 산출물을 질의할 수 있다.

## 12. 사내 배포 전략

### 12.1 핵심 결정

MVP의 배포 단위는 Obsidian 플러그인 단독 ZIP이 아니라 Git으로 배포되는 Obsidian vault template이다.

사용자는 사내 Git 저장소를 clone하고, 해당 폴더를 Obsidian vault로 연다. vault 안에는 플러그인 빌드 산출물과 공통 Obsidian 설정이 포함된다. 사용자별 인증 정보와 Confluence에서 내려받은 문서 산출물은 Git에서 제외한다.

이 결정은 다음 이유로 중요하다.

- 별도 스토어 출시 없이 사내 Git 저장소만으로 배포할 수 있다.
- 플러그인 설치 절차가 사실상 vault 열기 절차로 단순화된다.
- 모든 사용자가 동일한 플러그인 버전과 기본 Obsidian 설정을 사용할 수 있다.
- Confluence 문서 산출물과 개인 인증 정보는 로컬에만 남는다.
- 사용자가 필요하면 산출물 폴더를 별도 Git 저장소로 관리할 수 있다.

### 12.2 권장 vault template 구조

```text
confluence-vault-template/
  .obsidian/
    community-plugins.json
    plugins/
      confluence-obsidian-sync/
        main.js
        manifest.json
        styles.css

  .confluence-sync/
    config.example.json
    projects.example.json
    trash/

  confluence/
    .gitkeep

  graphify-out/
    .gitkeep

  .env.example
  .gitignore
  README.md
```

### 12.3 Git에 포함할 항목

- Obsidian vault 기본 설정
- Obsidian 플러그인 빌드 산출물
- 플러그인 공통 설정 템플릿
- `.env.example`
- `.gitignore`
- 사용 안내 문서
- 빈 Confluence 산출물 폴더 유지를 위한 `.gitkeep`
- 빈 graphify 산출물 폴더 유지를 위한 `.gitkeep`

### 12.4 Git에서 제외할 항목

- `.env`
- Confluence API token
- 사용자가 Pull Tree로 내려받은 Confluence Markdown 산출물
- 사용자별 프로젝트 상태 파일
- 안전 삭제 폴더 내용
- graphify 산출물
- Obsidian 개인 UI 상태와 캐시

권장 `.gitignore` 예시는 다음과 같다.

```gitignore
.env
confluence/*
!confluence/.gitkeep
graphify-out/*
!graphify-out/.gitkeep
.confluence-sync/projects.json
.confluence-sync/trash/*
!.confluence-sync/trash/.gitkeep
```

`.obsidian`은 전체를 무조건 커밋하지 않는다. 공통 배포에 필요한 최소 파일만 포함한다.

예시는 다음과 같다.

```gitignore
.obsidian/*
!.obsidian/community-plugins.json
!.obsidian/plugins/
!.obsidian/plugins/confluence-obsidian-sync/
!.obsidian/plugins/confluence-obsidian-sync/main.js
!.obsidian/plugins/confluence-obsidian-sync/manifest.json
!.obsidian/plugins/confluence-obsidian-sync/styles.css
```

### 12.5 사용자 설치 흐름

1. 사내 Git 저장소를 clone한다.
2. `.env.example`을 참고해 로컬 `.env`를 만든다.
3. Obsidian에서 clone한 폴더를 vault로 연다.
4. Community plugins를 활성화한다.
5. Confluence Obsidian Sync 플러그인을 활성화한다.
6. Confluence 루트 링크로 프로젝트를 생성한다.
7. Pull Tree를 실행해 `confluence/` 폴더에 문서를 내려받는다.
8. 필요하면 Codex, Claude Code, graphify 같은 외부 도구로 같은 vault 폴더를 연다.

### 12.6 배포 방식 비교 결론

Obsidian 플러그인만 ZIP으로 배포하면 사용자가 vault별 플러그인 폴더에 직접 압축을 풀어야 하므로 사내 비개발자에게 부담이 있다.

VS Code 확장은 `.vsix` 단일 파일 배포가 쉬우나, 이 제품의 핵심 사용 맥락인 Obsidian 기반 Markdown 문서 편집과 맞지 않는다.

vault template을 Git으로 배포하면 Obsidian 선택의 배포 약점이 줄어든다. 따라서 MVP는 Obsidian 플러그인을 유지하되, 배포 단위는 Git 기반 vault template으로 정의한다.

## 13. AI-ready workspace 전략

### 13.1 핵심 원칙

이 제품은 자체 개인 RAG 앱을 만들지 않는다. 대신 Confluence 문서를 로컬 Markdown workspace로 변환해, 사용자가 원하는 AI 도구가 직접 읽고 분석할 수 있게 한다.

이 방식의 장점은 다음과 같다.

- 별도 RAG 서버가 필요 없다.
- 별도 채팅 UI가 필요 없다.
- 벡터 DB를 제품에 포함하지 않아도 된다.
- 사용자가 Codex, Claude Code, graphify, 로컬 LLM 도구를 자유롭게 선택할 수 있다.
- 제품은 Pull Tree, Push Current Page, 메타데이터, 충돌 방지, 안전 삭제에 집중할 수 있다.

### 13.2 graphify의 위치

graphify는 MVP 필수 기능이 아니라 옵션 번들이다. vault template에는 graphify 실행 방법과 산출물 폴더 구조를 포함할 수 있다.

graphify의 역할은 다음과 같다.

- `confluence/` Markdown corpus 분석
- 문서 간 관계와 핵심 노드 파악
- `GRAPH_REPORT.md` 생성
- `graph.html` 시각화 생성
- `graph.json` 질의 보조 데이터 생성

graphify 산출물은 Git에 커밋하지 않는다. 산출물은 사용자 로컬 환경에서 재생성 가능한 분석 결과로 본다.

### 13.3 AI 도구 사용 경계

AI 도구는 로컬 Markdown과 graphify 산출물을 읽고 사용자를 도울 수 있다. 다만 Confluence 업로드는 플러그인의 `Push Current Page` 흐름을 통해서만 수행한다.

이 경계를 두는 이유는 다음과 같다.

- Confluence version 충돌 검사를 강제하기 위해서다.
- 잘못된 대량 업로드나 삭제를 막기 위해서다.
- AI 도구가 직접 Confluence API를 호출하지 않게 하기 위해서다.

## 14. 향후 확장

- 변경된 문서만 일괄 업로드
- 트리 전체 Overwrite
- 로컬 트리 기준 Confluence 페이지 생성
- 로컬 트리 기준 Confluence 페이지 이동
- 삭제 예정 문서 검토 UI
- 이미지와 첨부파일 처리
- Confluence macro 보존 전략
- 프로젝트 다중 관리
- 상세 diff UI
- graphify 실행 명령 통합
- 로컬 AI 도구 사용 가이드
