import { buildProjectManifest, buildProjectPaths } from "./projectManifest";
import { getConfluenceApiBaseUrl } from "../confluence/authentication";
import { fetchRootPageMetadata } from "../confluence/rootPageMetadata";
import { parseConfluencePageUrl } from "../confluence/pageUrl";
import type { ConfluenceRequestTransport } from "../confluence/requestTransport";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";
import { writeProjectManifest, type ProjectStorageAdapter } from "./projectStorage";

export interface CreateProjectFromRootUrlInput {
  settings: ConfluenceSyncSettings;
  rawRootUrl: string;
  transport: ConfluenceRequestTransport;
  storage: ProjectStorageAdapter;
  now: () => Date;
}

export interface CreateProjectFromRootUrlSuccess {
  ok: true;
  message: string;
  currentProject: CurrentConfluenceProjectSettings;
}

export interface CreateProjectFromRootUrlFailure {
  ok: false;
  message: string;
}

export type CreateProjectFromRootUrlResult = CreateProjectFromRootUrlSuccess | CreateProjectFromRootUrlFailure;

export async function createProjectFromRootUrl(
  input: CreateProjectFromRootUrlInput
): Promise<CreateProjectFromRootUrlResult> {
  const parsedRootUrlResult = parseConfluencePageUrl(input.rawRootUrl, input.settings.confluenceBaseUrl);

  if (!parsedRootUrlResult.ok) {
    return buildFailureResult(parsedRootUrlResult.message);
  }

  const metadataResult = await fetchRootPageMetadata(
    input.settings,
    parsedRootUrlResult.pageId,
    input.transport
  );

  if (!metadataResult.ok) {
    return buildFailureResult(metadataResult.message);
  }

  let paths;

  try {
    paths = buildProjectPaths(
      input.settings.defaultProjectFolder,
      metadataResult.metadata.title,
      metadataResult.metadata.pageId
    );
  } catch (error: unknown) {
    return buildFailureResult(getProjectPathErrorMessage(error));
  }

  const createdAt = input.now().toISOString();
  const manifest = buildProjectManifest({
    projectName: metadataResult.metadata.title,
    confluenceBaseUrl: getConfluenceApiBaseUrl(input.settings.confluenceBaseUrl),
    spaceId: metadataResult.metadata.spaceId,
    rootPageId: metadataResult.metadata.pageId,
    rootUrl: parsedRootUrlResult.rootUrl,
    localFolderPath: paths.projectRootPath,
    createdAt
  });
  const writeResult = await writeProjectManifest(input.storage, paths, manifest);

  if (!writeResult.ok) {
    return buildFailureResult(writeResult.message);
  }

  return {
    ok: true,
    message: `Confluence 프로젝트를 생성했습니다: ${manifest.projectName}`,
    currentProject: {
      projectName: manifest.projectName,
      spaceId: manifest.spaceId,
      rootPageId: manifest.rootPageId,
      rootUrl: manifest.rootUrl,
      localFolderPath: manifest.localFolderPath,
      manifestPath: writeResult.manifestPath
    }
  };
}

function buildFailureResult(message: string): CreateProjectFromRootUrlFailure {
  return {
    ok: false,
    message
  };
}

function getProjectPathErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "로컬 프로젝트 경로를 생성할 수 없습니다.";
}
