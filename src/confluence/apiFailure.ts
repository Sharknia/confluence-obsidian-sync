export type ConfluenceApiFailureReason =
  | "authentication-failed"
  | "permission-denied"
  | "not-found"
  | "network-error"
  | "rate-limited"
  | "version-conflict"
  | "invalid-response"
  | "api-error";

export interface ConfluenceApiFailure {
  reason: ConfluenceApiFailureReason;
  message: string;
}

export interface ConfluenceHttpFailureMessages {
  permissionDeniedMessage?: string;
  notFoundMessage?: string;
}

export function classifyConfluenceHttpFailure(
  status: number,
  messages: ConfluenceHttpFailureMessages = {}
): ConfluenceApiFailure {
  if (status === 401) {
    return {
      reason: "authentication-failed",
      message: "인증에 실패했습니다. Atlassian 이메일과 API token을 확인하세요."
    };
  }

  if (status === 403) {
    return {
      reason: "permission-denied",
      message: messages.permissionDeniedMessage ?? "Confluence 페이지에 접근할 권한이 없습니다. 페이지 권한을 확인하세요."
    };
  }

  if (status === 404) {
    return {
      reason: "not-found",
      message: messages.notFoundMessage ?? "Confluence 페이지를 찾을 수 없습니다. URL과 접근 권한을 확인하세요."
    };
  }

  if (status === 409) {
    return {
      reason: "version-conflict",
      message: "Confluence 페이지 version이 충돌했습니다. Pull Tree 후 다시 시도하세요."
    };
  }

  if (status === 429) {
    return {
      reason: "rate-limited",
      message: "Confluence API rate limit에 도달했습니다. 잠시 후 다시 시도하세요. HTTP 429"
    };
  }

  return {
    reason: "api-error",
    message: `Confluence API 오류가 발생했습니다. HTTP ${status}`
  };
}

export function createConfluenceNetworkFailure(message: string): ConfluenceApiFailure {
  return {
    reason: "network-error",
    message
  };
}
