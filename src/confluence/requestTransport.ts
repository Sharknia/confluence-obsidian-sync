import type { RequestUrlParam } from "obsidian";

export interface ConfluenceRequestResult {
  status: number;
  json: unknown;
}

export type ConfluenceRequestTransport = (request: RequestUrlParam) => Promise<ConfluenceRequestResult>;
