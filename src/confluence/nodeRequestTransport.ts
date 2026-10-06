import type { ConfluenceRequestResult, ConfluenceRequestTransport } from "./requestTransport";

export function createNodeRequestTransport(timeoutMilliseconds = 30_000): ConfluenceRequestTransport {
  return async (request) => {
    const initialOrigin = new URL(request.url).origin;
    const attachmentDownload = /^\/wiki\/rest\/api\/content\/[^/]+\/child\/attachment\/[^/]+\/download$/u.test(new URL(request.url).pathname);
    const signal = AbortSignal.timeout(timeoutMilliseconds);
    let url = request.url;
    let headers = request.headers;
    const redirectStatuses: number[] = [];
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await fetch(url, {
        method: request.method ?? "GET", headers,
        body: request.body, redirect: "manual", signal
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        redirectStatuses.push(response.status);
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 5 || (request.method && request.method !== "GET")) throw new Error("Confluence redirect를 처리할 수 없습니다.");
        const next = new URL(location, url);
        if (next.username || next.password) throw new Error("인증 정보를 포함한 redirect를 사용할 수 없습니다.");
        if (next.origin !== initialOrigin) {
          if (!attachmentDownload || next.origin !== "https://api.media.atlassian.com") throw new Error("다른 사이트로 인증 정보를 전달할 수 없습니다.");
          // 첨부 다운로드의 공식 미디어 경로에는 Confluence 인증·쿠키를 전달하지 않는다.
          headers = { Accept: "*/*" };
        }
        url = next.href;
        continue;
      }
      const result: ConfluenceRequestResult = { status: response.status, json: undefined,
        ...(redirectStatuses.length ? { redirectStatuses } : {}) };
      try {
        result.arrayBuffer = await response.arrayBuffer();
        result.text = new TextDecoder().decode(result.arrayBuffer);
        if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
          result.json = JSON.parse(result.text) as unknown;
        }
      } catch {
        // HTTP 성공 수신 사실은 본문 읽기·파싱 실패와 별도로 보존한다.
        result.bodyReadFailed = true;
      }
      return result;
    }
    throw new Error("Confluence redirect 횟수를 초과했습니다.");
  };
}
