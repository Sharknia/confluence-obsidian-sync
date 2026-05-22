import { requestUrl } from "obsidian";
import type { ConfluenceRequestTransport } from "./requestTransport";

export const createObsidianRequestTransport: ConfluenceRequestTransport = async (request) => {
  const response = (await requestUrl({ ...request, throw: false })) as {
    status: number;
    json: unknown;
    text?: string;
    arrayBuffer?: ArrayBuffer;
  };

  return {
    status: response.status,
    json: response.json,
    text: response.text,
    arrayBuffer: response.arrayBuffer
  };
};
