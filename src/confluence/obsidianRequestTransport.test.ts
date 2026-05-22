import { describe, expect, it, vi } from "vitest";
import { createObsidianRequestTransportFromRequestUrl } from "./obsidianRequestTransportFactory";

describe("createObsidianRequestTransportFromRequestUrl", () => {
  it("parses JSON responses eagerly", async () => {
    const json = { results: [] };
    let jsonReadCount = 0;
    const requestUrl = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        get json(): unknown {
          jsonReadCount += 1;

          return json;
        },
        text: JSON.stringify(json),
        arrayBuffer: new TextEncoder().encode(JSON.stringify(json)).buffer
      })
    );
    const transport = createObsidianRequestTransportFromRequestUrl(requestUrl);

    const result = await transport({ url: "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments" });

    expect(jsonReadCount).toBe(1);
    expect(result.json).toBe(json);
  });

  it("detects JSON responses with case-insensitive content-type headers", async () => {
    const json = { results: [] };
    const requestUrl = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: {
          "CONTENT-TYPE": "application/json; charset=utf-8"
        },
        json,
        text: JSON.stringify(json),
        arrayBuffer: new TextEncoder().encode(JSON.stringify(json)).buffer
      })
    );
    const transport = createObsidianRequestTransportFromRequestUrl(requestUrl);

    const result = await transport({ url: "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments" });

    expect(result.json).toBe(json);
  });

  it("rejects inside the transport when JSON parsing fails", async () => {
    const requestUrl = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        get json(): unknown {
          throw new Error("Invalid JSON");
        },
        text: "not-json",
        arrayBuffer: new TextEncoder().encode("not-json").buffer
      })
    );
    const transport = createObsidianRequestTransportFromRequestUrl(requestUrl);

    await expect(transport({ url: "https://selta.atlassian.net/wiki/api/v2/pages/100/attachments" })).rejects.toThrow("Invalid JSON");
  });

  it("does not parse JSON for HTML responses", async () => {
    const arrayBuffer = new TextEncoder().encode("<html><body>Prototype</body></html>").buffer;
    const response = {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8"
      },
      get json(): unknown {
        throw new Error("Unexpected JSON parse");
      },
      text: "<html><body>Prototype</body></html>",
      arrayBuffer
    };
    const requestUrl = vi.fn(() => Promise.resolve(response));
    const transport = createObsidianRequestTransportFromRequestUrl(requestUrl);

    const result = await transport({ url: "https://selta.atlassian.net/wiki/download/file.html" });

    expect(result.status).toBe(200);
    expect(result.text).toBe("<html><body>Prototype</body></html>");
    expect(result.arrayBuffer).toBe(arrayBuffer);
    expect(requestUrl).toHaveBeenCalledWith({ url: "https://selta.atlassian.net/wiki/download/file.html", throw: false });
  });

  it("does not parse JSON when download responses have no headers", async () => {
    const requestUrl = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: undefined,
        get json(): unknown {
          throw new Error("Unexpected JSON parse");
        },
        text: "<html><body>Prototype</body></html>",
        arrayBuffer: new TextEncoder().encode("<html><body>Prototype</body></html>").buffer
      })
    );
    const transport = createObsidianRequestTransportFromRequestUrl(requestUrl);

    await expect(transport({ url: "https://selta.atlassian.net/wiki/download/file.html" })).resolves.toMatchObject({
      status: 200,
      text: "<html><body>Prototype</body></html>"
    });
  });
});
