import { normalizeConfluenceBaseUrl, type ConfluenceSyncSettings } from "../settings/defaultSettings";

export type RequiredConfluenceConnectionField =
  | "Confluence base URL"
  | "Atlassian account email"
  | "API token";

export function getMissingConfluenceConnectionFields(
  settings: ConfluenceSyncSettings
): RequiredConfluenceConnectionField[] {
  const missingFields: RequiredConfluenceConnectionField[] = [];

  if (isMissingStringSetting(settings.confluenceBaseUrl)) {
    missingFields.push("Confluence base URL");
  }

  if (isMissingStringSetting(settings.userEmail)) {
    missingFields.push("Atlassian account email");
  }

  if (isMissingStringSetting(settings.apiToken)) {
    missingFields.push("API token");
  }

  return missingFields;
}

function isMissingStringSetting(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

export function buildBasicAuthorizationHeader(userEmail: string, apiToken: string): string {
  const credential = `${userEmail.trim()}:${apiToken.trim()}`;
  return `Basic ${Buffer.from(credential, "utf8").toString("base64")}`;
}

export function buildConfluenceApiUrl(baseUrl: string, restPath: string): string {
  const apiBaseUrl = getConfluenceApiBaseUrl(baseUrl);
  const normalizedRestPath = restPath.startsWith("/") ? restPath : `/${restPath}`;

  return `${apiBaseUrl}${normalizedRestPath}`;
}

export function getConfluenceApiBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = normalizeConfluenceBaseUrl(baseUrl);

  return normalizedBaseUrl.endsWith("/wiki") ? normalizedBaseUrl.slice(0, -"/wiki".length) : normalizedBaseUrl;
}
