import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ConfluenceSyncSettingTab", () => {
  it("설정 화면에서 수동 Create project UI를 제공하지 않는다", () => {
    const source = readFileSync("src/settings/ConfluenceSyncSettingTab.ts", "utf8");

    expect(source).not.toContain("Create project");
    expect(source).not.toContain("createProjectFromRootUrl");
    expect(source).toContain("Pull Tree 또는 Force Pull Tree 실행 시 필요한 경우 자동으로 프로젝트를 생성합니다.");
  });
});
