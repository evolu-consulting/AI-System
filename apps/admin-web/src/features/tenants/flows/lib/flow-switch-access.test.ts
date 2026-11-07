import { describe, expect, test } from "bun:test";
import { canSeeFlowSwitch } from "./flow-switch-access";

describe("CR-123 FR-09 · ai thấy công tắc Dùng quy trình mới", () => {
  test("quản trị nền tảng và quản trị công ty thấy", () => {
    expect(canSeeFlowSwitch("platform_admin")).toBe(true);
    expect(canSeeFlowSwitch("tenant_admin")).toBe(true);
  });
  test("người dùng khác của công ty, chưa đăng nhập: không thấy", () => {
    expect(canSeeFlowSwitch("member")).toBe(false);
    expect(canSeeFlowSwitch("auditor")).toBe(false);
    expect(canSeeFlowSwitch(undefined)).toBe(false);
  });
});
