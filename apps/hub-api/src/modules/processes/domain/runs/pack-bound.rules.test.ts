// contract-flow fix-review · run gắn bản ghi gói (`packBound`): không huỷ qua API process-runs (kể cả người bắt đầu/admin —
// chỉ gói `cancelSys`); người bắt đầu (= người gửi HĐ) không quyết decision; admin + Group duyệt (redo/back_limit) như cũ.
import { describe, expect, test } from "bun:test";
import { canCancel, canDecide } from "./run-access.rules";

const run = {
  tenantId: "t",
  startedBy: "starter",
  originRoom: "none" as const,
  taskAssignee: true,
};
const pack = { ...run, packBound: true };
const v = (userId: string, role: "member" | "tenant_admin" | "platform_admin" = "member") => ({
  userId,
  tenantId: "t",
  role,
});
const dec = (reason: "redo_limit" | "interrupted", reviewGroupMember = false) => ({
  reason,
  reviewGroupMember,
});

describe("fix-review · canCancel run gắn gói", () => {
  test("run thường: người bắt đầu + admin huỷ được (như cũ)", () => {
    expect(canCancel(v("starter"), run)).toBe(true);
    expect(canCancel(v("adm", "tenant_admin"), run)).toBe(true);
  });
  test("run gắn gói: không ai huỷ qua API", () => {
    expect(canCancel(v("starter"), pack)).toBe(false);
    expect(canCancel(v("adm", "tenant_admin"), pack)).toBe(false);
    expect(canCancel(v("p", "platform_admin"), pack)).toBe(false);
  });
});

describe("fix-review · canDecide run gắn gói", () => {
  test("người bắt đầu không quyết (mọi lý do)", () => {
    expect(canDecide(v("starter"), { ...pack, ...dec("interrupted") })).toBe(false);
    expect(canDecide(v("starter"), { ...pack, ...dec("redo_limit") })).toBe(false);
    expect(canDecide(v("starter"), { ...run, ...dec("interrupted") })).toBe(true);
  });
  test("admin vẫn quyết; Group duyệt quyết redo_limit", () => {
    expect(canDecide(v("adm", "tenant_admin"), { ...pack, ...dec("interrupted") })).toBe(true);
    expect(canDecide(v("rv"), { ...pack, ...dec("redo_limit", true) })).toBe(true);
    expect(canDecide(v("rv"), { ...pack, ...dec("interrupted", true) })).toBe(false);
  });
});
