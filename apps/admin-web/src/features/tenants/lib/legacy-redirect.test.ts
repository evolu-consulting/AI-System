// CR-112 · ADM-FR-76 AC2/AC3 · ánh xạ route cũ → tab workspace công ty.
import { describe, expect, it } from "bun:test";
import { type LegacyContext, legacyTarget, processesRedirectTenant } from "./legacy-redirect";

const ctx = (over: Partial<LegacyContext> = {}): LegacyContext => ({
  role: "platform_admin",
  ownTenantId: "own-id",
  lastTenantId: undefined,
  idForKey: (k) => ({ acme: "acme-id", globex: "globex-id" })[k],
  ...over,
});

describe("ADM-FR-76 · legacyTarget", () => {
  it("platform_admin + ?tenant=<mã> ⇒ workspace công ty đó, giữ query, bỏ tenant", () => {
    expect(
      legacyTarget("users", { tenant: "acme", q: "an", status: "locked", page: "3" }, ctx()),
    ).toEqual({
      to: "/tenants/$tenantId",
      params: { tenantId: "acme-id" },
      search: expect.objectContaining({
        tab: "members",
        view: "users",
        q: "an",
        status: "locked",
        page: 3,
      }),
    });
    const t = legacyTarget("groups", { tenant: "globex" }, ctx());
    expect(t).toMatchObject({
      params: { tenantId: "globex-id" },
      search: { tab: "members", view: "groups" },
    });
  });

  it("platform_admin không chọn: dùng công ty chọn gần nhất; chưa có ⇒ danh sách công ty; mã lạ ⇒ danh sách", () => {
    expect(legacyTarget("partners", {}, ctx({ lastTenantId: "globex-id" }))).toMatchObject({
      params: { tenantId: "globex-id" },
      search: { tab: "members", view: "partners" },
    });
    expect(legacyTarget("users", {}, ctx())).toEqual({ to: "/tenants" });
    expect(
      legacyTarget("users", { tenant: "khong-co" }, ctx({ lastTenantId: "globex-id" })),
    ).toEqual({
      to: "/tenants",
    });
  });

  it("tenant_admin luôn về công ty mình, bỏ qua ?tenant=", () => {
    const c = ctx({ role: "tenant_admin" });
    expect(legacyTarget("users", { tenant: "globex" }, c)).toMatchObject({
      params: { tenantId: "own-id" },
      search: { tab: "members", view: "users" },
    });
    expect(legacyTarget("agents", {}, c)).toMatchObject({
      search: { tab: "members", view: "agents" },
    });
  });

  it("Phân quyền: ?tab=check cũ thành tab con view=check, user giữ nguyên", () => {
    expect(
      legacyTarget("access", { tab: "check", user: "an", tenant: "acme" }, ctx()),
    ).toMatchObject({
      params: { tenantId: "acme-id" },
      search: { tab: "members", view: "access", mode: "check", user: "an" },
    });
  });

  it("member không có workspace ⇒ danh sách (guard route đã chặn trước)", () => {
    expect(legacyTarget("users", {}, ctx({ role: "member" }))).toEqual({ to: "/tenants" });
  });
});

describe("CR-121 c13 · /processes?tenant= chuyển tới Công ty › Quy trình", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const OWN = "22222222-2222-4222-8222-222222222222";
  it("platform_admin kèm ?tenant=<id> ⇒ công ty đó (kể cả kèm bộ lọc); không có/mã lạ/bộ lọc ?usedBy= ⇒ ở lại thư viện", () => {
    expect(processesRedirectTenant("platform_admin", { tenant: T }, undefined)).toBe(T);
    expect(processesRedirectTenant("platform_admin", {}, undefined)).toBeNull();
    expect(
      processesRedirectTenant("platform_admin", { tenant: T, app: "contracts" }, undefined),
    ).toBe(T);
    expect(processesRedirectTenant("platform_admin", { usedBy: T }, undefined)).toBeNull();
    expect(processesRedirectTenant("platform_admin", { tenant: "none" }, undefined)).toBeNull();
  });
  it("tenant_admin luôn về công ty mình; member không chuyển", () => {
    expect(processesRedirectTenant("tenant_admin", {}, OWN)).toBe(OWN);
    expect(processesRedirectTenant("tenant_admin", { tenant: T }, OWN)).toBe(OWN);
    expect(processesRedirectTenant("member", {}, OWN)).toBeNull();
  });
});
