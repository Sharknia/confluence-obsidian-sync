import type { RequestUrlParam } from "obsidian";

export interface ConfluenceRequestResult {
  status: number;
  json: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
}

export type ConfluenceRequestTransport = (request: RequestUrlParam) => Promise<ConfluenceRequestResult>;
