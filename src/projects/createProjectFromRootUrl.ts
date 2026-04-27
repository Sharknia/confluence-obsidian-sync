import { buildProjectManifest, buildProjectPaths } from "./projectManifest";
import { getConfluenceApiBaseUrl } from "../confluence/authentication";
import { fetchRootFolderMetadata } from "../confluence/rootFolderMetadata";
import { fetchRootPageMetadata } from "../confluence/rootPageMetadata";
import { parseConfluenceRootUrl, type ConfluenceRootContentType } from "../confluence/pageUrl";
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

interface RootContentMetadata {
  rootContentType: ConfluenceRootContentType;
  rootContentId: string;
  projectName: string;
  spaceId: string;
}

export async function createProjectFromRootUrl(
  input: CreateProjectFromRootUrlInput
): Promise<CreateProjectFromRootUrlResult> {
  const parsedRootUrlResult = parseConfluenceRootUrl(input.rawRootUrl, input.settings.confluenceBaseUrl);

  if (!parsedRootUrlResult.ok) {
    return buildFailureResult(parsedRootUrlResult.message);
  }

  const metadataResult = await fetchRootContentMetadata(
    input.settings,
    parsedRootUrlResult.rootContentType,
    parsedRootUrlResult.rootContentId,
    input.transport
  );

  if (!metadataResult.ok) {
    return buildFailureResult(metadataResult.message);
  }

  const rootContentMetadata = metadataResult.metadata;
  let paths;

  try {
    paths = buildProjectPaths(
      input.settings.defaultProjectFolder,
      rootContentMetadata.projectName,
      rootContentMetadata.rootContentId,
      rootContentMetadata.rootContentType
    );
  } catch (error: unknown) {
    return buildFailureResult(getProjectPathErrorMessage(error));
  }

  const createdAt = input.now().toISOString();
  const manifest = buildProjectManifest({
    projectName: rootContentMetadata.projectName,
    confluenceBaseUrl: getConfluenceApiBaseUrl(input.settings.confluenceBaseUrl),
    spaceId: rootContentMetadata.spaceId,
    rootContentType: rootContentMetadata.rootContentType,
    rootContentId: rootContentMetadata.rootContentId,
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
      rootContentType: manifest.rootContentType,
      rootContentId: manifest.rootContentId,
      rootPageId: manifest.rootPageId,
      rootUrl: manifest.rootUrl,
      localFolderPath: manifest.localFolderPath,
      manifestPath: writeResult.manifestPath
    }
  };
}

async function fetchRootContentMetadata(
  settings: ConfluenceSyncSettings,
  rootContentType: ConfluenceRootContentType,
  rootContentId: string,
  transport: ConfluenceRequestTransport
): Promise<{ ok: true; metadata: RootContentMetadata } | CreateProjectFromRootUrlFailure> {
  if (rootContentType === "page") {
    const metadataResult = await fetchRootPageMetadata(settings, rootContentId, transport);

    if (!metadataResult.ok) {
      return buildFailureResult(metadataResult.message);
    }

    return {
      ok: true,
      metadata: {
        rootContentType,
        rootContentId: metadataResult.metadata.pageId,
        projectName: metadataResult.metadata.title,
        spaceId: metadataResult.metadata.spaceId
      }
    };
  }

  const metadataResult = await fetchRootFolderMetadata(settings, rootContentId, transport);

  if (!metadataResult.ok) {
    return buildFailureResult(metadataResult.message);
  }

  return {
    ok: true,
    metadata: {
      rootContentType,
      rootContentId: metadataResult.metadata.folderId,
      projectName: metadataResult.metadata.title,
      spaceId: metadataResult.metadata.spaceId
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
