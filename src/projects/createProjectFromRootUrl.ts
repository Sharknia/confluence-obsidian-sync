import { buildProjectManifest, buildProjectPaths } from "./projectManifest";
import { getConfluenceApiBaseUrl } from "../confluence/authentication";
import { fetchRootFolderMetadata } from "../confluence/rootFolderMetadata";
import { fetchRootPageMetadata } from "../confluence/rootPageMetadata";
import { parseConfluenceRootUrl, type ConfluenceRootContentType } from "../confluence/pageUrl";
import type { ConfluenceRequestTransport } from "../confluence/requestTransport";
import type { ConfluenceSyncSettings, CurrentConfluenceProjectSettings } from "../settings/defaultSettings";
import { writeProjectManifest, type ProjectStorageAdapter } from "./projectStorage";

const MAX_PROJECT_FOLDER_CANDIDATES = 100;

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

type CreatedProjectManifest = ReturnType<typeof buildProjectManifest>;

interface CreatedProjectManifestWriteSuccess {
  ok: true;
  manifest: CreatedProjectManifest;
  manifestPath: string;
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
  const createdAt = input.now().toISOString();
  const writeResult = await writeManifestToFirstAvailableProjectPath({
    input,
    rootContentMetadata,
    rootUrl: parsedRootUrlResult.rootUrl,
    createdAt
  });

  if (!writeResult.ok) {
    return buildFailureResult(writeResult.message);
  }

  const manifest = writeResult.manifest;

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

interface WriteManifestToFirstAvailableProjectPathInput {
  input: CreateProjectFromRootUrlInput;
  rootContentMetadata: RootContentMetadata;
  rootUrl: string;
  createdAt: string;
}

async function writeManifestToFirstAvailableProjectPath({
  input,
  rootContentMetadata,
  rootUrl,
  createdAt
}: WriteManifestToFirstAvailableProjectPathInput): Promise<
  CreatedProjectManifestWriteSuccess | CreateProjectFromRootUrlFailure
> {
  for (let collisionIndex = 0; collisionIndex < MAX_PROJECT_FOLDER_CANDIDATES; collisionIndex += 1) {
    let paths;

    try {
      paths = buildProjectPaths(
        input.settings.defaultProjectFolder,
        rootContentMetadata.projectName,
        rootContentMetadata.rootContentId,
        rootContentMetadata.rootContentType,
        collisionIndex
      );
    } catch (error: unknown) {
      return buildFailureResult(getProjectPathErrorMessage(error));
    }

    const projectRootExists = await input.storage.exists(paths.projectRootPath);
    const manifestExists = await input.storage.exists(paths.manifestPath);

    if (projectRootExists && !manifestExists) {
      continue;
    }

    const manifest = buildProjectManifest({
      projectName: rootContentMetadata.projectName,
      confluenceBaseUrl: getConfluenceApiBaseUrl(input.settings.confluenceBaseUrl),
      spaceId: rootContentMetadata.spaceId,
      rootContentType: rootContentMetadata.rootContentType,
      rootContentId: rootContentMetadata.rootContentId,
      rootUrl,
      localFolderPath: paths.projectRootPath,
      createdAt
    });
    const writeResult = await writeProjectManifest(input.storage, paths, manifest);

    if (writeResult.ok) {
      return {
        ok: true,
        manifest,
        manifestPath: writeResult.manifestPath
      };
    }

    if (writeResult.reason !== "manifest-already-exists") {
      return buildFailureResult(writeResult.message);
    }
  }

  return buildFailureResult("사용 가능한 로컬 프로젝트 폴더명을 찾을 수 없습니다.");
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
