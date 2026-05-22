import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { ConfluenceRequestTransport } from "./requestTransport";

type ObsidianRequestUrl = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

export function createObsidianRequestTransportFromRequestUrl(requestUrl: ObsidianRequestUrl): ConfluenceRequestTransport {
  return async (request) => {
    const response = await requestUrl({ ...request, throw: false });
    const json = isJsonResponse(response) ? (response.json as unknown) : undefined;

    return {
      status: response.status,
      json,
      text: response.text,
      arrayBuffer: response.arrayBuffer
    };
  };
}

function isJsonResponse(response: RequestUrlResponse): boolean {
  const contentType = getResponseHeader(response, "content-type");

  return typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
}

function getResponseHeader(response: RequestUrlResponse, headerName: string): string | undefined {
  if (response.headers === undefined || response.headers === null) {
    return undefined;
  }

  const normalizedHeaderName = headerName.toLowerCase();

  for (const [name, value] of Object.entries(response.headers)) {
    if (name.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }

  return undefined;
}
