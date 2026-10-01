// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-BR-05, ADM-BR-08, ADM-BR-09 · luật thuần users (plan.md §4 `users.rules.ts`).
import { describe, expect, it } from "bun:test";
import { loadUsersRules } from "../_modules";

type Role = "platform_admin" | "tenant_admin" | "member";
const actor = (role: Role, userId = "u-actor", tenantId = "t-1") => ({ userId, tenantId, role });
const PLATFORM = actor("platform_admin");
const TENANT_ADMIN = actor("tenant_admin");

describe("ADM-BR-05 · role", () => {
  it("ADM-BR-05 · M1-R12 · isAdminRole và canManageUsers: member không quản trị được", async () => {
    const r = await loadUsersRules();
    expect(r.isAdminRole("platform_admin")).toBe(true);
    expect(r.isAdminRole("tenant_admin")).toBe(true);
    expect(r.isAdminRole("member")).toBe(false);
    expect(r.canManageUsers(PLATFORM)).toBe(true);
    expect(r.canManageUsers(TENANT_ADMIN)).toBe(true);
    expect(r.canManageUsers(actor("member"))).toBe(false);
  });

  it("ADM-BR-05 · M1-R12 · checkRoleAssignment: tenant platform chỉ có platform_admin; tenant thường chỉ tenant_admin/member", async () => {
    const r = await loadUsersRules();
    const bad = { code: "ROLE_NOT_ALLOWED" };
    expect(r.checkRoleAssignment(PLATFORM, true, "member")).toMatchObject(bad);
    expect(r.checkRoleAssignment(PLATFORM, true, "tenant_admin")).toMatchObject(bad);
    expect(r.checkRoleAssignment(PLATFORM, false, "platform_admin")).toMatchObject(bad);
    expect(r.checkRoleAssignment(TENANT_ADMIN, false, "platform_admin")).toMatchObject(bad);
    expect(r.checkRoleAssignment(PLATFORM, true, "platform_admin")).toBeNull();
    for (const a of [PLATFORM, TENANT_ADMIN]) {
      expect(r.checkRoleAssignment(a, false, "member")).toBeNull();
      expect(r.checkRoleAssignment(a, false, "tenant_admin")).toBeNull();
    }
  });

  it("ADM-BR-05 · M1-R16 · isEmailRequired: chỉ tenant_admin", async () => {
    const r = await loadUsersRules();
    expect(r.isEmailRequired("tenant_admin")).toBe(true);
    expect(r.isEmailRequired("member")).toBe(false);
    expect(r.isEmailRequired("platform_admin")).toBe(false);
  });
});

describe("ADM-BR-09 · cách ly tenant", () => {
  it("ADM-BR-09 · M1-R13 · resolveTenantScope: tenant_admin luôn tenant mình dù query tenant khác (đọc và ghi)", async () => {
    const r = await loadUsersRules();
    for (const op of ["read", "write"]) {
      expect(r.resolveTenantScope(TENANT_ADMIN, "t-other", op)).toEqual({ tenantId: "t-1" });
      expect(r.resolveTenantScope(TENANT_ADMIN, undefined, op)).toEqual({ tenantId: "t-1" });
    }
  });

  it("ADM-BR-09 · M1-R14 · resolveTenantScope: platform đọc thiếu query → null; ghi thiếu → TENANT_REQUIRED; có id → id", async () => {
    const r = await loadUsersRules();
    expect(r.resolveTenantScope(PLATFORM, undefined, "read")).toEqual({ tenantId: null });
    expect(r.resolveTenantScope(PLATFORM, undefined, "write")).toMatchObject({
      code: "TENANT_REQUIRED",
    });
    expect(r.resolveTenantScope(PLATFORM, "t-9", "write")).toEqual({ tenantId: "t-9" });
    expect(r.resolveTenantScope(PLATFORM, "t-9", "read")).toEqual({ tenantId: "t-9" });
  });

  it("ADM-BR-09 · M1-R13 · canSeeUser: cùng tenant true, khác tenant false (→ 404 ở route)", async () => {
    const r = await loadUsersRules();
    expect(r.canSeeUser(TENANT_ADMIN, { tenantId: "t-1" })).toBe(true);
    expect(r.canSeeUser(TENANT_ADMIN, { tenantId: "t-2" })).toBe(false);
  });
});

describe("ADM-BR-08 · không tự khoá/hạ, luôn còn admin", () => {
  it("ADM-BR-08 · M1-R11 · checkRoleChange: đổi role platform_admin (bởi người khác) → ROLE_NOT_ALLOWED", async () => {
    const r = await loadUsersRules();
    const target = { id: "u-target", role: "platform_admin" };
    for (const next of ["member", "tenant_admin"]) {
      expect(r.checkRoleChange(PLATFORM, target, next)).toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    }
  });

  it("ADM-BR-08 · M1-R11 · checkRoleChange: tự đổi role → SELF_ACTION_FORBIDDEN (kể cả platform_admin tự hạ, plan §10 G2)", async () => {
    const r = await loadUsersRules();
    const self = actor("tenant_admin", "u-me");
    expect(r.checkRoleChange(self, { id: "u-me", role: "member" }, "tenant_admin")).toMatchObject({
      code: "SELF_ACTION_FORBIDDEN",
    });
    const me = actor("platform_admin", "u-me");
    expect(r.checkRoleChange(me, { id: "u-me", role: "platform_admin" }, "member")).toMatchObject({
      code: "SELF_ACTION_FORBIDDEN",
    });
  });

  it("ADM-BR-08 · M1-R11 · checkRoleChange: đổi role người khác → null; giữ nguyên role của chính mình → null", async () => {
    const r = await loadUsersRules();
    expect(
      r.checkRoleChange(TENANT_ADMIN, { id: "u-x", role: "member" }, "tenant_admin"),
    ).toBeNull();
    const self = actor("tenant_admin", "u-me");
    expect(
      r.checkRoleChange(self, { id: "u-me", role: "tenant_admin" }, "tenant_admin"),
    ).toBeNull();
  });

  it("ADM-BR-08 · M1-R11 · checkSelfAction: tự lock/reset_password → SELF_ACTION_FORBIDDEN; người khác → null", async () => {
    const r = await loadUsersRules();
    const me = actor("tenant_admin", "u-me");
    for (const action of ["lock", "reset_password"]) {
      expect(r.checkSelfAction(me, "u-me", action)).toMatchObject({
        code: "SELF_ACTION_FORBIDDEN",
      });
      expect(r.checkSelfAction(me, "u-other", action)).toBeNull();
    }
  });

  it("ADM-BR-08 · M1-R11 · checkLastAdmin: khoá tenant_admin cuối → LAST_ADMIN {scope:'tenant'}; còn người khác → null", async () => {
    const r = await loadUsersRules();
    const t = { role: "tenant_admin", active: true };
    expect(r.checkLastAdmin(t, { active: false }, 0)).toEqual({
      code: "LAST_ADMIN",
      details: { scope: "tenant" },
    });
    expect(r.checkLastAdmin(t, { active: false }, 1)).toBeNull();
  });

  it("ADM-BR-08 · M1-R11 · checkLastAdmin: platform_admin cuối → scope 'platform'", async () => {
    const r = await loadUsersRules();
    const t = { role: "platform_admin", active: true };
    expect(r.checkLastAdmin(t, { active: false }, 0)).toEqual({
      code: "LAST_ADMIN",
      details: { scope: "platform" },
    });
    expect(r.checkLastAdmin(t, { active: false }, 1)).toBeNull();
  });

  it("ADM-BR-08 · M1-R11 · checkLastAdmin: hạ role tenant_admin→member: others=0 → LAST_ADMIN, others=2 → null", async () => {
    const r = await loadUsersRules();
    const t = { role: "tenant_admin", active: true };
    expect(r.checkLastAdmin(t, { role: "member" }, 0)).toMatchObject({ code: "LAST_ADMIN" });
    expect(r.checkLastAdmin(t, { role: "member" }, 2)).toBeNull();
  });

  it("ADM-BR-08 · M1-R11 · checkLastAdmin: member, admin đã khoá, hoặc thay đổi không làm mất admin → luôn null", async () => {
    const r = await loadUsersRules();
    expect(r.checkLastAdmin({ role: "member", active: true }, { active: false }, 0)).toBeNull();
    expect(
      r.checkLastAdmin({ role: "tenant_admin", active: false }, { active: false }, 0),
    ).toBeNull();
    expect(
      r.checkLastAdmin({ role: "tenant_admin", active: false }, { role: "member" }, 0),
    ).toBeNull();
    const t = { role: "tenant_admin", active: true };
    expect(r.checkLastAdmin(t, {}, 0)).toBeNull();
    expect(r.checkLastAdmin(t, { active: true }, 0)).toBeNull();
  });
});

describe("ADM-FR-04 · trạng thái và version", () => {
  it("ADM-FR-04 · M1-R10 · userStatus: locked ⇔ !active || lockedByTenant", async () => {
    const r = await loadUsersRules();
    expect(r.userStatus({ active: true, lockedByTenant: false })).toBe("active");
    expect(r.userStatus({ active: false, lockedByTenant: false })).toBe("locked");
    expect(r.userStatus({ active: true, lockedByTenant: true })).toBe("locked");
    expect(r.userStatus({ active: false, lockedByTenant: true })).toBe("locked");
  });

  it("ADM-FR-04 · spec §3 · bumpsVersion: trường admin sửa được/trạng thái tăng version; bộ đếm đăng nhập thì không", async () => {
    const r = await loadUsersRules();
    const bumps = [
      "display_name",
      "email",
      "role",
      "locale",
      "active",
      "locked_by_tenant",
      "must_change_password",
      "name",
      "max_concurrent_sub",
    ];
    for (const f of bumps) expect(r.bumpsVersion([f])).toBe(true);
    expect(r.bumpsVersion([])).toBe(false);
    for (const f of ["failed_logins", "locked_until", "last_login_at"]) {
      expect(r.bumpsVersion([f])).toBe(false);
    }
    expect(r.bumpsVersion(["last_login_at", "email"])).toBe(true);
  });
});
