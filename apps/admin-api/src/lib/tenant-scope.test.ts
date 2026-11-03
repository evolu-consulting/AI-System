// CR-112 · ADM-FR-81 · luật thuần phạm vi tenant.
import { describe, expect, it } from "bun:test";
import { canAddressTenant } from "./tenant-scope";

describe("ADM-FR-81 · canAddressTenant", () => {
  it("platform_admin mọi tenant; tenant_admin/member chỉ tenant mình", () => {
    expect(canAddressTenant({ role: "platform_admin", tenantId: "p" }, "x")).toBe(true);
    expect(canAddressTenant({ role: "tenant_admin", tenantId: "a" }, "a")).toBe(true);
    expect(canAddressTenant({ role: "tenant_admin", tenantId: "a" }, "b")).toBe(false);
    expect(canAddressTenant({ role: "member", tenantId: "a" }, "b")).toBe(false);
  });
});
