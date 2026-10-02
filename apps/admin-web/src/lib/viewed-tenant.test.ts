// ADM-FR-62 · resolveViewedTenant (hàm thuần theo dữ liệu): tenant_admin cố định, platform chọn qua URL, mã lạ → unknown.
import { describe, expect, test } from "bun:test";
import type { Me } from "@ai/contracts";
import { resolveViewedTenant } from "./viewed-tenant";

const me = (role: Me["role"]) => ({ role, tenant: { key: "acme" } }) as unknown as Me;
const options = { data: [{ id: "t1", key: "acme" }] };

describe("ADM-FR-62 · resolveViewedTenant", () => {
  test("tenant_admin: tenant của mình, không gửi tenantId", () => {
    const v = resolveViewedTenant(me("tenant_admin"), "khac", options);
    expect(v).toMatchObject({
      tenantKey: "acme",
      tenantId: undefined,
      unknown: false,
      ready: true,
    });
  });

  test("platform: chưa chọn → chưa có tenantKey; chọn đúng → tenantId", () => {
    expect(resolveViewedTenant(me("platform_admin"), undefined, options)).toMatchObject({
      tenantKey: null,
      tenantId: undefined,
      ready: true,
    });
    expect(resolveViewedTenant(me("platform_admin"), "acme", options)).toMatchObject({
      tenantKey: "acme",
      tenantId: "t1",
    });
  });

  test("platform: mã lạ → unknown; chưa tải danh sách → chưa sẵn sàng", () => {
    expect(resolveViewedTenant(me("platform_admin"), "zzz", options)).toMatchObject({
      unknown: true,
      ready: false,
    });
    expect(resolveViewedTenant(me("platform_admin"), "acme", {}).ready).toBe(false);
  });
});
