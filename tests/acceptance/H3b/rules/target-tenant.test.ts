// ADM-FR-37 · H3b-R01, R02 · HUB-H3b-AC-01 · test-plan-cases H3b §1.1 R01–R07: `targetTenant` quyết tenant đích một lần
// (member 403, tenant_admin chỉ tenant mình, platform_admin bắt buộc `tenant_id`; role lạ ⇒ FORBIDDEN).
import { describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts";
import {
  type TargetTenant,
  targetTenant,
} from "../../../../apps/hub-api/src/modules/agent-grants/agent-grants.rules";

const ACME = "a3b00000-0000-4000-8000-0000000000a1";
const BETA = "a3b00000-0000-4000-8000-0000000000b1";
const PLATFORM = "a3b00000-0000-4000-8000-0000000000c1";
const QS = [undefined, ACME, BETA] as const;
/** Role lạ: kiểu `Role` không cho, nhưng JWT/khối gọi có thể đưa tới (phòng thủ). */
const odd = (r: string) => r as unknown as Role;

describe("targetTenant [ADM-FR-37 · H3b-R01, R02 · HUB-H3b-AC-01]", () => {
  it("ADM-FR-37 · R01 · member × q {vắng, = tid, ≠ tid} ⇒ FORBIDDEN [H3b-R01 · HUB-H3b-AC-01]", () => {
    for (const q of QS)
      expect(targetTenant({ role: "member", tenantId: ACME }, q)).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
  });

  it("ADM-FR-37 · R02 · tenant_admin q vắng · q = tid ⇒ tenant mình [H3b-R02 · HUB-H3b-AC-01]", () => {
    for (const q of [undefined, ACME])
      expect(targetTenant({ role: "tenant_admin", tenantId: ACME }, q)).toEqual({
        ok: true,
        tenantId: ACME,
      });
  });

  it("ADM-FR-37 · R03 · tenant_admin q ≠ tid ⇒ NOT_FOUND (không lộ tồn tại) [H3b-R02 · HUB-BR-14]", () => {
    expect(targetTenant({ role: "tenant_admin", tenantId: ACME }, BETA)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("ADM-FR-37 · R04 · platform_admin q vắng ⇒ TENANT_REQUIRED [H3b-R02 · HUB-H3b-AC-01]", () => {
    expect(targetTenant({ role: "platform_admin", tenantId: PLATFORM }, undefined)).toEqual({
      ok: false,
      code: "TENANT_REQUIRED",
    });
  });

  it("ADM-FR-37 · R05 · platform_admin q = acme · beta · platform ⇒ tenantId = q [H3b-R02]", () => {
    for (const q of [ACME, BETA, PLATFORM])
      expect(targetTenant({ role: "platform_admin", tenantId: PLATFORM }, q)).toEqual({
        ok: true,
        tenantId: q,
      });
  });

  it('ADM-FR-37 · R06 · role lạ "owner", "" × 3 q ⇒ FORBIDDEN [H3b-R01]', () => {
    for (const r of ["owner", ""])
      for (const q of QS)
        expect(targetTenant({ role: odd(r), tenantId: ACME }, q)).toEqual({
          ok: false,
          code: "FORBIDDEN",
        });
  });

  it("ADM-FR-37 · R07 · bảng 5 role × 3 q (15 dòng viết tay); không dòng tenant_admin nào ra tenantId ≠ tid [H3b-R01, R02]", () => {
    const F = { ok: false, code: "FORBIDDEN" } as const;
    const ok = (t: string) => ({ ok: true, tenantId: t }) as const;
    const table: [string, string | undefined, TargetTenant][] = [
      ["member", undefined, F],
      ["member", ACME, F],
      ["member", BETA, F],
      ["tenant_admin", undefined, ok(ACME)],
      ["tenant_admin", ACME, ok(ACME)],
      ["tenant_admin", BETA, { ok: false, code: "NOT_FOUND" }],
      ["platform_admin", undefined, { ok: false, code: "TENANT_REQUIRED" }],
      ["platform_admin", ACME, ok(ACME)],
      ["platform_admin", BETA, ok(BETA)],
      ["owner", undefined, F],
      ["owner", ACME, F],
      ["owner", BETA, F],
      ["", undefined, F],
      ["", ACME, F],
      ["", BETA, F],
    ];
    const got = table.map(([r, q]) => [r, q, targetTenant({ role: odd(r), tenantId: ACME }, q)]);
    expect(got).toEqual(table);
    for (const [r, , v] of got) {
      const t = v as { ok: boolean; tenantId?: string };
      if (r === "tenant_admin" && t.ok) expect(t.tenantId).toBe(ACME);
    }
  });
});
