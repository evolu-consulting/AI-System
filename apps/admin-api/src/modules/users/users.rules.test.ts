// ADM-BR-08, ADM-BR-05 · biên luật users (plan M1 §8).
import { describe, expect, test } from "bun:test";
import { checkLastAdmin, checkRoleAssignment, checkRoleChange } from "./users.rules";

const pa = { userId: "p", tenantId: "t0", role: "platform_admin" as const };

describe("ADM-BR-08 · checkLastAdmin", () => {
  test("ADM-BR-08 · đổi tenant_admin → tenant_admin hoặc active=true không bao giờ là mất admin", () => {
    const t = { role: "tenant_admin" as const, active: true };
    expect(checkLastAdmin(t, { role: "tenant_admin" }, 0)).toBeNull();
    expect(checkLastAdmin(t, { role: "member", active: true }, 0)).toMatchObject({
      code: "LAST_ADMIN",
    });
  });
});

describe("ADM-BR-05 · role", () => {
  test("ADM-BR-05 · platform_admin không tự đổi role mình kể cả khi đích hợp lệ; giữ nguyên role → null", () => {
    expect(checkRoleChange(pa, { id: "p", role: "platform_admin" }, "tenant_admin")).toMatchObject({
      code: "SELF_ACTION_FORBIDDEN",
    });
    expect(checkRoleChange(pa, { id: "x", role: "member" }, "member")).toBeNull();
    expect(checkRoleAssignment(pa, false, "member")).toBeNull();
  });
});
