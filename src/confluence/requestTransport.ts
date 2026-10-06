import type { RequestUrlParam } from "obsidian";

export interface ConfluenceRequestResult {
  status: number;
  json: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
  bodyReadFailed?: boolean;
  redirectStatuses?: number[];
}

export function requireRequestTransport(transport?: ConfluenceRequestTransport): ConfluenceRequestTransport {
  if (!transport) throw new Error("Confluence 요청 transport가 필요합니다.");
  return transport;
}

export type ConfluenceRequestTransport = (request: RequestUrlParam) => Promise<ConfluenceRequestResult>;
