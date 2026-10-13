// HUB-FR-128 · PC-R14 · B5b · luật thuần đọc diff/log tự sửa.
import { describe, expect, test } from "bun:test";
import { autofixReadTenant, canReadAutofixFile } from "./autofix-files.rules";

const T_OWN = "11111111-1111-4111-8111-111111111111";
const T_Q = "22222222-2222-4222-8222-222222222222";

describe("autofixReadTenant [PC-R14]", () => {
  test("platform_admin + ?tenant_id ⇒ tenant đích", () => {
    expect(autofixReadTenant({ role: "platform_admin", tenantId: T_OWN }, T_Q)).toBe(T_Q);
  });
  test("platform_admin không ?tenant_id ⇒ tenant của mình", () => {
    expect(autofixReadTenant({ role: "platform_admin", tenantId: T_OWN }, undefined)).toBe(T_OWN);
  });
  test("tenant_admin / member: ?tenant_id bị bỏ qua (không mạo danh tenant khác)", () => {
    expect(autofixReadTenant({ role: "tenant_admin", tenantId: T_OWN }, T_Q)).toBe(T_OWN);
    expect(autofixReadTenant({ role: "member", tenantId: T_OWN }, T_Q)).toBe(T_OWN);
  });
});

describe("canReadAutofixFile [PC-R14, HUB-BR-25]", () => {
  test("full / task ⇒ đọc được; null ⇒ 404", () => {
    expect(canReadAutofixFile("full")).toBe(true);
    expect(canReadAutofixFile("task")).toBe(true);
    expect(canReadAutofixFile(null)).toBe(false);
  });
});
