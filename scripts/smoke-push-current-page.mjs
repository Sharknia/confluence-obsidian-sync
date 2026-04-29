/* global Buffer, console, fetch, process */

const requiredEnvironmentVariables = [
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_USER_EMAIL",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_PAGE_ID",
];

for (const variableName of requiredEnvironmentVariables) {
  if (!process.env[variableName]) {
    console.error(`Missing required environment variable: ${variableName}`);
    process.exit(1);
  }
}

const baseUrl = process.env.CONFLUENCE_BASE_URL.replace(/\/+$/u, "");
const pageId = process.env.CONFLUENCE_PAGE_ID;
const authorization = `Basic ${Buffer.from(
  `${process.env.CONFLUENCE_USER_EMAIL}:${process.env.CONFLUENCE_API_TOKEN}`,
  "utf8",
).toString("base64")}`;

function buildPageUrl() {
  return `${baseUrl}/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`;
}

function buildUpdatePageUrl() {
  return `${baseUrl}/wiki/api/v2/pages/${encodeURIComponent(pageId)}`;
}

async function requestJson(label, url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      ...(init.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));

  if (typeof json !== "object" || json === null) {
    throw new Error(`${label} returned a non-object JSON response`);
  }

  return { status: response.status, json };
}

function readPageSummary(label, result) {
  const version = result.json?.version?.number;
  const title = result.json?.title;
  const id = result.json?.id;

  if (result.status !== 200 || id !== pageId || typeof title !== "string" || typeof version !== "number") {
    throw new Error(`${label} failed validation status=${result.status}`);
  }

  return { title, version };
}

function readPageSummaryWithBody(label, result) {
  const summary = readPageSummary(label, result);
  const bodyStorageValue = result.json?.body?.storage?.value;

  if (typeof bodyStorageValue !== "string") {
    throw new Error(`${label} failed body validation status=${result.status}`);
  }

  return { ...summary, bodyStorageValue };
}

const initialResult = await requestJson("GET page", buildPageUrl(), { method: "GET" });
const initialPage = readPageSummaryWithBody("GET page", initialResult);
console.log(`GET page status=${initialResult.status} count=1 version=${initialPage.version}`);

const nextVersion = initialPage.version + 1;
const updateResult = await requestJson("PUT page", buildUpdatePageUrl(), {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: pageId,
    status: "current",
    title: initialPage.title,
    body: {
      representation: "storage",
      value: `${initialPage.bodyStorageValue}<p>Smoke test update ${new Date().toISOString()}</p>`,
    },
    version: { number: nextVersion },
  }),
});
const updatedPage = readPageSummary("PUT page", updateResult);
console.log(`PUT page status=${updateResult.status} count=1 version=${updatedPage.version}`);

if (updatedPage.version !== nextVersion) {
  throw new Error(`PUT version mismatch expected=${nextVersion} actual=${updatedPage.version}`);
}

const verifyResult = await requestJson("GET verify", buildPageUrl(), { method: "GET" });
const verifiedPage = readPageSummary("GET verify", verifyResult);
console.log(`GET verify status=${verifyResult.status} count=1 version=${verifiedPage.version}`);

if (verifiedPage.version !== updatedPage.version) {
  throw new Error(`Verify version mismatch expected=${updatedPage.version} actual=${verifiedPage.version}`);
}
