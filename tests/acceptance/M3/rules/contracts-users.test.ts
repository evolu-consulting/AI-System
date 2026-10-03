// ADM-FR-62 · M3-R13 · contract `User` có `groups`/`group_count` + `?group=` (spec M3 §3 "Users"; test-plan R1b).
// Xanh ở T4 (users.ts đổi ở T4). Trước đó đỏ vì chưa có code.
import { describe, expect, it } from "bun:test";
import { UserListQuerySchema, UserSchema, UserUpdateRequestSchema } from "@ai/contracts";

const U = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const baseUser = {
  id: U(1),
  tenant_id: U(2),
  tenant_key: "acme",
  username: "lan",
  display_name: "Lan Tran",
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
  version: 1,
  updated_by: null, // M4-R17 · CR-016
  totp_enabled: false, // M4 plan-cd §4.1 · D-K03 (xanh từ T9d)
};
const group = (i: number) => ({
  id: U(100 + i),
  key: `nhom-${i}`,
  name: { vi: `Nhóm ${i}` },
  is_beta: false,
});
const ok = (r: { success: boolean }) => r.success;

describe("ADM-FR-62 · User.groups (M3-R13)", () => {
  it("ADM-FR-62 · M3-R13 · UserSchema có groups ≤ 50 (51 fail) + group_count; thiếu groups/group_count fail (hình mới ở mọi response)", () => {
    const u = (n: number) => ({
      ...baseUser,
      groups: Array.from({ length: n }, (_, i) => group(i)),
      group_count: n,
    });
    expect(ok(UserSchema.safeParse(u(0)))).toBe(true);
    expect(ok(UserSchema.safeParse(u(50)))).toBe(true);
    expect(ok(UserSchema.safeParse(u(51)))).toBe(false);
    expect(ok(UserSchema.safeParse({ ...baseUser, groups: [] }))).toBe(false);
    expect(ok(UserSchema.safeParse({ ...baseUser, group_count: 0 }))).toBe(false);
    expect(ok(UserSchema.safeParse({ ...u(1), extra: 1 }))).toBe(false);
  });

  it("ADM-FR-62 · M3-R13 · UserListQuery.group là uuid ('abc' fail); PATCH user KHÔNG nhận group_ids (khoá lạ fail, A11)", () => {
    expect(ok(UserListQuerySchema.safeParse({ group: U(5) }))).toBe(true);
    expect(ok(UserListQuerySchema.safeParse({ group: "abc" }))).toBe(false);
    expect(ok(UserUpdateRequestSchema.safeParse({ version: 1, group_ids: [U(5)] }))).toBe(false);
    expect(ok(UserUpdateRequestSchema.safeParse({ version: 1, display_name: "A" }))).toBe(true);
  });
});
