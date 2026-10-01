import { describe, expect, test } from "bun:test";
import { rowActions, userStatusView } from "./status";

const now = new Date("2026-10-01T10:00:00.000Z");
const base = { active: true, locked_by_tenant: false, locked_until: null };

describe("ADM-FR-04 · trạng thái user", () => {
  test("hoạt động / khoá / khoá theo tenant / tạm khoá", () => {
    expect(userStatusView(base, now)).toEqual({ kind: "active" });
    expect(userStatusView({ ...base, active: false }, now)).toEqual({
      kind: "locked",
      byTenant: false,
    });
    expect(userStatusView({ ...base, locked_by_tenant: true }, now)).toEqual({
      kind: "locked",
      byTenant: true,
    });
    const future = "2026-10-01T10:15:00.000Z";
    expect(userStatusView({ ...base, locked_until: future }, now)).toEqual({
      kind: "tempLocked",
      until: future,
    });
  });

  test("khoá tạm đã hết hạn → hoạt động", () => {
    expect(userStatusView({ ...base, locked_until: "2026-10-01T09:00:00.000Z" }, now)).toEqual({
      kind: "active",
    });
  });

  test("hàng (bạn) không có hành động nào ngoài Sửa", () => {
    expect(rowActions(base, true, now)).toEqual({
      resetPassword: false,
      lock: false,
      unlock: false,
      unlockEnabled: false,
      logoutAll: false,
    });
  });

  test("user hoạt động: Khoá; khoá riêng: Mở khoá; khoá theo tenant: Mở khoá bị vô hiệu", () => {
    expect(rowActions(base, false, now)).toMatchObject({ lock: true, unlock: false });
    expect(rowActions({ ...base, active: false }, false, now)).toMatchObject({
      lock: false,
      unlock: true,
      unlockEnabled: true,
    });
    expect(rowActions({ ...base, locked_by_tenant: true }, false, now)).toMatchObject({
      unlock: true,
      unlockEnabled: false,
    });
  });
});
