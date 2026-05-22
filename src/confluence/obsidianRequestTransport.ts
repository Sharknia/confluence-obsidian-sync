import { requestUrl } from "obsidian";
import type { ConfluenceRequestTransport } from "./requestTransport";
import { createObsidianRequestTransportFromRequestUrl } from "./obsidianRequestTransportFactory";

export const createObsidianRequestTransport: ConfluenceRequestTransport = createObsidianRequestTransportFromRequestUrl(requestUrl);
