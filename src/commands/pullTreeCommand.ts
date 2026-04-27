import { getMissingConfluenceConnectionFields, type RequiredConfluenceConnectionField } from "../confluence/authentication";
import {
  fetchConfluenceRootContentTree,
  type ConfluenceRootContentTreeResult,
  type ConfluenceRootContentType
} from "../confluence/pageTree";
import { buildPageMarkdownFiles } from "../projects/pageMarkdown";
import { writeMarkdownPages, type ProjectStorageAdapter } from "../projects/projectStorage";
import type { ConfluenceSyncSettings } from "../settings/defaultSettings";

export type PullTreeFetcher = (
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string
) => Promise<ConfluenceRootContentTreeResult>;

export interface RunPullTreeCommandInput {
  settings: ConfluenceSyncSettings;
  storage: ProjectStorageAdapter;
  fetchTree?: PullTreeFetcher;
  showNotice: (message: string) => void;
}

const defaultPullTreeFetcher: PullTreeFetcher = async (settings, rootContentType, rootContentId) => {
  const { createObsidianRequestTransport } = await import("../confluence/obsidianRequestTransport");

  return fetchConfluenceRootContentTree(settings, rootContentType, rootContentId, createObsidianRequestTransport);
};

export async function runPullTreeCommand({
  settings,
  storage,
  fetchTree = defaultPullTreeFetcher,
  showNotice
}: RunPullTreeCommandInput): Promise<void> {
  const missingFields = getMissingConfluenceConnectionFields(settings);

  if (missingFields.length > 0) {
    showNotice(
      `Pull Tree 실행 전에 Confluence 연결 설정이 필요합니다: ${missingFields
        .map(toSettingsFieldName)
        .join(", ")}`
    );
    return;
  }

  const currentProject = settings.currentProject;

  if (currentProject === null) {
    showNotice("Pull Tree 실행 전에 설정 화면에서 루트 콘텐츠 기반 프로젝트를 생성하세요.");
    return;
  }

  try {
    const result = await fetchTree(settings, currentProject.rootContentType, currentProject.rootContentId);

    if (!result.ok) {
      showNotice(result.message);
      return;
    }

    let markdownFiles: Awaited<ReturnType<typeof buildPageMarkdownFiles>>;
    let writeResult: Awaited<ReturnType<typeof writeMarkdownPages>>;

    try {
      markdownFiles = await buildPageMarkdownFiles({
        projectRootPath: currentProject.localFolderPath,
        root: result.root,
        pages: result.pages,
        pathExists: (path) => storage.exists(path),
        readExistingFile: (path) => storage.read(path)
      });
      writeResult = await writeMarkdownPages(storage, markdownFiles);
    } catch {
      showNotice("Markdown 파일을 저장할 수 없습니다.");
      return;
    }

    if (!writeResult.ok) {
      showNotice("Markdown 파일을 저장할 수 없습니다.");
      return;
    }

    const conversionWarningCount = markdownFiles.reduce((count, file) => count + file.warnings.length, 0);
    showNotice(
      `Confluence 페이지를 Markdown으로 저장했습니다: ${writeResult.writtenFileCount}개${buildSuccessNoticeSuffix(
        result.errors.length,
        conversionWarningCount
      )}`
    );
  } catch (error) {
    console.error("Pull Tree 실행 중 예기치 못한 오류가 발생했습니다.", error);

    const message = error instanceof Error ? error.message : "Confluence 페이지 트리 조회 중 알 수 없는 오류가 발생했습니다.";
    showNotice(message);
  }
}

function buildSuccessNoticeSuffix(fetchFailureCount: number, conversionWarningCount: number): string {
  const suffixes: string[] = [];

  if (fetchFailureCount > 0) {
    suffixes.push(`조회 실패 ${fetchFailureCount}개`);
  }

  if (conversionWarningCount > 0) {
    suffixes.push(`변환 경고 ${conversionWarningCount}개`);
  }

  return suffixes.length > 0 ? `, ${suffixes.join(", ")}` : "";
}

function toSettingsFieldName(field: RequiredConfluenceConnectionField): string {
  return field === "API token" ? "apiToken" : field;
}
