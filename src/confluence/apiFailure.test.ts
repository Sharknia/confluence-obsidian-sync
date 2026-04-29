import { describe, expect, it } from "vitest";
import { classifyConfluenceHttpFailure, createConfluenceNetworkFailure } from "./apiFailure";

describe("classifyConfluenceHttpFailure", () => {
  it.each([
    {
      status: 401,
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    },
    {
      status: 403,
      reason: "permission-denied",
      message: "Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."
    },
    {
      status: 404,
      reason: "not-found",
      message: "Confluence 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    },
    {
      status: 409,
      reason: "version-conflict",
      message: "Confluence 페이지 version이 충돌했습니다. Pull Tree 후 다시 시도하세요."
    },
    {
      status: 429,
      reason: "rate-limited",
      message: "Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"
    },
    {
      status: 503,
      reason: "api-error",
      message: "Confluence API 오류가 발생했습니다. HTTP 503"
    }
  ])("classifies HTTP $status as $reason", ({ status, reason, message }) => {
    expect(classifyConfluenceHttpFailure(status)).toEqual({ reason, message });
  });

  it("allows context-specific permission and not found messages", () => {
    expect(
      classifyConfluenceHttpFailure(statusCode(403), {
        permissionDeniedMessage: "Confluence 페이지를 수정할 권한이 없습니다."
      })
    ).toEqual({
      reason: "permission-denied",
      message: "Confluence 페이지를 수정할 권한이 없습니다."
    });

    expect(
      classifyConfluenceHttpFailure(statusCode(404), {
        notFoundMessage: "Confluence 루트 페이지를 찾을 수 없습니다."
      })
    ).toEqual({
      reason: "not-found",
      message: "Confluence 루트 페이지를 찾을 수 없습니다."
    });
  });
});

describe("createConfluenceNetworkFailure", () => {
  it("creates a network-error failure with caller message", () => {
    expect(createConfluenceNetworkFailure("네트워크 오류로 Confluence 페이지를 조회할 수 없습니다.")).toEqual({
      reason: "network-error",
      message: "네트워크 오류로 Confluence 페이지를 조회할 수 없습니다."
    });
  });
});

function statusCode(status: number): number {
  return status;
}
