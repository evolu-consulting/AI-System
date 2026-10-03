// ADM-FR-08 · M4-R16 · unit totp.rules (ca biên ngoài test-plan-cd §1.1).
import { describe, expect, it } from "bun:test";
import { canResetTotpFor, generateBackupCodes, normalizeBackupCode } from "./totp.rules";

describe("ADM-FR-08 · totp.rules", () => {
  it("ADM-FR-08 · nguồn chỉ trả byte ≥ 248 → ném (không treo)", () => {
    expect(() => generateBackupCodes((n) => new Uint8Array(n).fill(250))).toThrow();
  });

  it("ADM-FR-08 · mã sinh ra chuẩn hoá được về 8 ký tự", () => {
    let i = 0;
    const codes = generateBackupCodes((n) => Uint8Array.from({ length: n }, () => i++ % 248));
    for (const c of codes) expect(normalizeBackupCode(c)).toBe(c.replace("-", ""));
  });

  it("ADM-FR-08 · ADM-BR-09 · tenant_admin khác tenant với chính id mình → NOT_FOUND trước", () => {
    const a = { userId: "u1", tenantId: "t1", role: "tenant_admin" as const };
    expect(canResetTotpFor(a, { id: "u1", tenantId: "t2" })).toEqual({ code: "NOT_FOUND" });
  });
});
