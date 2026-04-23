import { normalizeConfluenceBaseUrl, type ConfluenceSyncSettings } from "../settings/defaultSettings";

export type RequiredConfluenceConnectionField =
  | "Confluence base URL"
  | "Atlassian account email"
  | "API token";

export function getMissingConfluenceConnectionFields(
  settings: ConfluenceSyncSettings
): RequiredConfluenceConnectionField[] {
  const missingFields: RequiredConfluenceConnectionField[] = [];

  if (settings.confluenceBaseUrl.trim().length === 0) {
    missingFields.push("Confluence base URL");
  }

  if (settings.userEmail.trim().length === 0) {
    missingFields.push("Atlassian account email");
  }

  if (settings.apiToken.trim().length === 0) {
    missingFields.push("API token");
  }

  return missingFields;
}

export function buildBasicAuthorizationHeader(userEmail: string, apiToken: string): string {
  const credential = `${userEmail.trim()}:${apiToken.trim()}`;
  return `Basic ${Buffer.from(credential, "utf8").toString("base64")}`;
}

export function buildConfluenceApiUrl(baseUrl: string, restPath: string): string {
  const normalizedBaseUrl = normalizeConfluenceBaseUrl(baseUrl);
  const normalizedRestPath = restPath.startsWith("/") ? restPath : `/${restPath}`;

  return `${normalizedBaseUrl}${normalizedRestPath}`;
}
