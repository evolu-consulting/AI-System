import { describe, expect, test } from "bun:test";
import { canSeeFlowSwitch, switchStateOf } from "./flow-switch-access";

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

describe("CR-125 · c2 · khối quy trình mới không còn công tắc bật bắt buộc", () => {
  test("đang dùng ⇒ on (chỉ có nút Tạm dừng), có quy trình nhưng chưa dùng/đã tạm dừng ⇒ idle (chỉ lời chỉ dẫn), chưa có quy trình ⇒ none", () => {
    expect(switchStateOf({ flow_triggers: true, has_active_flow: true })).toBe("on");
    expect(switchStateOf({ flow_triggers: false, has_active_flow: true })).toBe("idle");
    expect(switchStateOf({ flow_triggers: false, has_active_flow: false })).toBe("none");
  });
});
