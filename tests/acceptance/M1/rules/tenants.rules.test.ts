// ADM-FR-60, ADM-FR-61 · luật thuần tenants (plan.md §4 `tenants.rules.ts`).
import { describe, expect, it } from "bun:test";
import { loadTenantsRules } from "../_modules";

const actor = (role: string) => ({ userId: "u1", tenantId: "t1", role });

describe("ADM-FR-60 · luật tenants", () => {
  it("ADM-FR-60 · M1-R15 · PLATFORM_TENANT_KEY là 'platform'; canManageTenants chỉ platform_admin", async () => {
    const r = await loadTenantsRules();
    expect(r.PLATFORM_TENANT_KEY).toBe("platform");
    expect(r.canManageTenants(actor("platform_admin"))).toBe(true);
    expect(r.canManageTenants(actor("tenant_admin"))).toBe(false);
    expect(r.canManageTenants(actor("member"))).toBe(false);
  });

  it("ADM-FR-61 · M1-R10 · checkTenantLock: platform → PLATFORM_TENANT_LOCKED, tenant khác → null", async () => {
    const r = await loadTenantsRules();
    expect(r.checkTenantLock({ key: "platform" })).toMatchObject({
      code: "PLATFORM_TENANT_LOCKED",
    });
    expect(r.checkTenantLock({ key: "acme" })).toBeNull();
  });

  it("ADM-FR-61 · M1-R10 · tenantStatus: active ⇒ 'active', ngược lại 'locked'", async () => {
    const r = await loadTenantsRules();
    expect(r.tenantStatus({ active: true })).toBe("active");
    expect(r.tenantStatus({ active: false })).toBe("locked");
  });
});
