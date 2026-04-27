# Confluence Obsidian Sync

Confluence 문서를 Obsidian에서 편집 가능한 로컬 Markdown 작업 사본으로 내려받고, 안전하게 반복 Pull하기 위한 Obsidian 플러그인입니다.

## Pull 결과 확인

Pull Tree 실행 후 결과 요약은 Obsidian Notice로 표시됩니다.

상세 기록은 프로젝트 폴더 안의 다음 파일에 남습니다.

```text
<project-folder>/.confluence-sync/pull-reports/latest.md
```

예:

```text
confluence/기획 문서/.confluence-sync/pull-reports/latest.md
```

`latest.md`에는 다음 내용이 기록됩니다.

- 추가, 갱신, 안전 삭제, 변경 없음 개수
- 로컬 수정 스킵 파일 경로
- 스킵 사유
- 안전 삭제 이동 경로
- 조회 실패와 변환 경고 개수

로컬 수정 스킵 사유는 다음과 같습니다.

- `local-change`: 마지막 Pull 이후 로컬 Markdown 본문이 변경됨
- `legacy-body-mismatch`: 이전 형식 파일에 content hash가 없고, 원격 변환 본문과 로컬 본문이 다름
- `duplicate-page-id`: 같은 Confluence pageId를 가진 로컬 Markdown 파일이 중복됨
- `disappeared-local-change`: Confluence에서 사라진 페이지지만 로컬 수정이 있어 안전 삭제하지 않음

Notice를 놓쳤거나 스킵된 파일의 원인을 확인해야 하면 `pull-reports/latest.md`를 먼저 확인하세요.

## 개발

```bash
pnpm install
pnpm run verify
pnpm run prepare:current-vault
```
