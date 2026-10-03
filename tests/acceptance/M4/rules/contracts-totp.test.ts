// ADM-FR-08 · M4-AC11 · contract khối D (plan-cd §4.1–4.2): `packages/contracts/src/totp.ts` + sửa `auth.ts`
// (`LoginResponseSchema`, `MeSchema`), `users.ts` (`UserSchema`). Xanh ở T9d (schema tạo dần ở T9b–T9d).
// Tên schema request verify: `TotpVerifyRequestSchema` (plan-cd chưa đặt tên — xem test-plan-cd §10 "Cần bổ sung").
import { describe, expect, it } from "bun:test";
import { LoginResponseSchema, MeSchema, UserSchema } from "@ai/contracts";
import { loadTotpContract } from "../_cd-modules";

const ok = (r: { success: boolean }) => r.success;
const U = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const me = {
  id: U(11),
  tenant: { id: U(1), key: "acme", name: "Acme" },
  username: "binh",
  display_name: "Binh Le",
  email: "binh@acme.test",
  role: "tenant_admin",
  locale: "vi",
  must_change_password: false,
  totp_enabled: true,
  totp_enabled_at: "2026-10-01T09:00:00.000Z",
  backup_codes_left: 10,
};
const user = {
  id: U(13),
  tenant_id: U(1),
  tenant_key: "acme",
  username: "an",
  display_name: "An Nguyen",
  email: null,
  role: "member",
  locale: "vi",
  status: "active",
  active: true,
  locked_by_tenant: false,
  locked_until: null,
  must_change_password: false,
  last_login_at: null,
  created_at: "2026-10-01T09:00:00.000Z",
  updated_at: "2026-10-01T09:00:00.000Z",
  updated_by: null,
  version: 1,
  groups: [],
  group_count: 0,
  totp_enabled: false,
};

describe("ADM-FR-08 · contract 2FA", () => {
  it("ADM-FR-08 · D-K01 · verify request: đúng một trong code (6 số) / backup_code (xxxx-xxxx, không phân biệt hoa thường); khoá lạ fail", async () => {
    const { TotpVerifyRequestSchema: S } = await loadTotpContract();
    const t = { totp_token: "a.b.c" };
    expect(ok(S.safeParse({ ...t, code: "012345" }))).toBe(true);
    expect(ok(S.safeParse({ ...t, backup_code: "K7P2-9XQM" }))).toBe(true);
    expect(ok(S.safeParse({ ...t, backup_code: "k7p29xqm" }))).toBe(true);
    for (const bad of [
      { ...t, code: "12345" },
      { ...t, code: "12a456" },
      { ...t, code: "123456", backup_code: "k7p29xqm" },
      { ...t },
      { ...t, code: "123456", extra: 1 },
    ]) {
      expect(ok(S.safeParse(bad))).toBe(false);
    }
  });

  it("ADM-FR-08 · D-K02 · M4-AC11 · LoginResponseSchema có nhánh totp_required (expires_in 300; 600 fail); nhánh M1 vẫn qua", () => {
    const need = { status: "totp_required", totp_token: "a.b.c", expires_in: 300 };
    expect(ok(LoginResponseSchema.safeParse(need))).toBe(true);
    expect(ok(LoginResponseSchema.safeParse({ ...need, expires_in: 600 }))).toBe(false);
    expect(ok(LoginResponseSchema.safeParse({ ...need, access_token: "x" }))).toBe(false);
    const change = { status: "password_change_required", change_token: "a.b.c", expires_in: 300 };
    expect(ok(LoginResponseSchema.safeParse(change))).toBe(true);
    const grant = {
      status: "authenticated",
      access_token: "a.b.c",
      token_type: "Bearer",
      expires_in: 900,
      user: me,
    };
    expect(ok(LoginResponseSchema.safeParse(grant))).toBe(true);
  });

  it("ADM-FR-08 · D-K03 · MeSchema/UserSchema có totp_enabled (bắt buộc); backup_codes_left 0..10", () => {
    expect(ok(MeSchema.safeParse(me))).toBe(true);
    const { totp_enabled: _a, ...noFlag } = me;
    expect(ok(MeSchema.safeParse(noFlag))).toBe(false);
    for (const n of [0, 10])
      expect(ok(MeSchema.safeParse({ ...me, backup_codes_left: n }))).toBe(true);
    for (const n of [11, -1])
      expect(ok(MeSchema.safeParse({ ...me, backup_codes_left: n }))).toBe(false);
    expect(ok(UserSchema.safeParse(user))).toBe(true);
    const { totp_enabled: _b, ...noUserFlag } = user;
    expect(ok(UserSchema.safeParse(noUserFlag))).toBe(false);
  });
});
