// CR-112 · ADM-FR-76 AC2/AC3 · ánh xạ route cũ → tab workspace công ty.
import { describe, expect, it } from "bun:test";
import { type LegacyContext, legacyTarget } from "./legacy-redirect";

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
      search: expect.objectContaining({ tab: "users", q: "an", status: "locked", page: 3 }),
    });
    const t = legacyTarget("groups", { tenant: "globex" }, ctx());
    expect(t).toMatchObject({ params: { tenantId: "globex-id" }, search: { tab: "groups" } });
  });

  it("platform_admin không chọn: dùng công ty chọn gần nhất; chưa có ⇒ danh sách công ty; mã lạ ⇒ danh sách", () => {
    expect(legacyTarget("partners", {}, ctx({ lastTenantId: "globex-id" }))).toMatchObject({
      params: { tenantId: "globex-id" },
      search: { tab: "partners" },
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
      search: { tab: "users" },
    });
    expect(legacyTarget("agents", {}, c)).toMatchObject({ search: { tab: "agents" } });
  });

  it("Phân quyền: ?tab=check cũ thành tab con view=check, user giữ nguyên", () => {
    expect(
      legacyTarget("access", { tab: "check", user: "an", tenant: "acme" }, ctx()),
    ).toMatchObject({
      params: { tenantId: "acme-id" },
      search: { tab: "access", view: "check", user: "an" },
    });
  });

  it("member không có workspace ⇒ danh sách (guard route đã chặn trước)", () => {
    expect(legacyTarget("users", {}, ctx({ role: "member" }))).toEqual({ to: "/tenants" });
  });
});
