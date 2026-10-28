import { describe, expect, test } from "bun:test";
import { partnerUserActions, partnerUserStatus } from "./status";

const now = new Date("2026-10-01T10:00:00.000Z");
const ok = { active: true, locked_by_tenant: false, locked_until: null };

describe("ADM-FR-75 · trạng thái tài khoản đối tác", () => {
  test("hoạt động / khoá / khoá tạm còn hạn / vô hiệu", () => {
    expect(partnerUserStatus(ok, now)).toBe("active");
    expect(partnerUserStatus({ ...ok, active: false }, now)).toBe("locked");
    expect(partnerUserStatus({ ...ok, locked_by_tenant: true }, now)).toBe("locked");
    expect(partnerUserStatus({ ...ok, locked_until: "2026-10-01T10:05:00.000Z" }, now)).toBe(
      "locked",
    );
    expect(partnerUserStatus({ ...ok, locked_until: "2026-10-01T09:00:00.000Z" }, now)).toBe(
      "active",
    );
    expect(partnerUserStatus({ ...ok, deactivated_at: "2026-09-30T00:00:00.000Z" }, now)).toBe(
      "deactivated",
    );
  });

  test("vô hiệu thắng khoá (user vô hiệu thường đồng thời active=false)", () => {
    const u = { ...ok, active: false, deactivated_at: "2026-09-30T00:00:00.000Z" };
    expect(partnerUserStatus(u, now)).toBe("deactivated");
  });
});

describe("ADM-FR-75 · hành động theo tài khoản", () => {
  test("hoạt động: đặt lại, khoá, vô hiệu — không mở khoá", () => {
    expect(partnerUserActions(ok, true, now)).toEqual({
      resetPassword: true,
      lock: true,
      unlock: false,
      deactivate: true,
    });
  });

  test("đã khoá: mở khoá khi công ty còn hoạt động, ngược lại không", () => {
    const locked = { ...ok, active: false };
    expect(partnerUserActions(locked, true, now).unlock).toBe(true);
    expect(partnerUserActions(locked, true, now).lock).toBe(false);
    expect(partnerUserActions(locked, false, now).unlock).toBe(false);
  });

  test("đã vô hiệu: mọi hành động bị tắt", () => {
    const dead = { ...ok, deactivated_at: "2026-09-30T00:00:00.000Z" };
    expect(Object.values(partnerUserActions(dead, true, now)).some(Boolean)).toBe(false);
  });
});
