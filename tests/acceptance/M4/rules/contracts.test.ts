// ADM-FR-40, ADM-FR-42, ADM-FR-51, ADM-FR-52 · M4-R17 · contract M4 khối A + B (test-plan R20; plan-contract §2).
// Xanh ở T0b. Import qua namespace (kiểu lỏng): export chưa có thì `bun run typecheck` vẫn xanh, ca đỏ ở `expect`.
// Đếm tổng 48 mã `API_ERRORS` ở `rules/contracts-cd.test.ts` (D-K04, khối C + D) — ở đây chỉ `toMatchObject`.
import { describe, expect, it } from "bun:test";
import * as Contracts from "@ai/contracts";
import type { Loose } from "../_modules";

const C = Contracts as unknown as Loose;
const U = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ok = (schema: Loose | undefined, v: unknown): boolean => {
  expect(schema).toBeDefined();
  return Boolean(schema?.safeParse(v).success);
};

describe("ADM-FR-51 · ADM-FR-52 · mã lỗi và enum M4 (A + B)", () => {
  it("ADM-FR-52 · M4-R13 · API_ERRORS có NAME_TAKEN, NOT_RESTORABLE, RESTORE_REF_MISSING = 409; mã cũ giữ nguyên", () => {
    expect(C.API_ERRORS).toMatchObject({
      NAME_TAKEN: 409,
      NOT_RESTORABLE: 409,
      RESTORE_REF_MISSING: 409,
      VERSION_CONFLICT: 409,
      VALIDATION_ERROR: 400,
      INVALID_REFERENCE: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
    });
  });

  it("ADM-FR-40 · CONFIG_ENTITIES thêm 'quota' ngay trước 'batch'; tổng 11", () => {
    const e = [...(C.CONFIG_ENTITIES as string[])];
    expect(e).toHaveLength(11);
    expect(e).toContain("quota");
    expect(e.indexOf("quota")).toBe(e.indexOf("batch") - 1);
    expect(e.at(-1)).toBe("batch");
  });

  it("ADM-FR-51 · M4-R11 · AUDIT_ENTITIES đúng 12 giá trị, AUDIT_ACTIONS đúng 9 giá trị", () => {
    expect([...((C.AUDIT_ENTITIES ?? []) as string[])].sort()).toEqual(
      [
        "tenant",
        "user",
        "user_totp",
        "group",
        "grant",
        "entitlement",
        "feature",
        "workflow",
        "command",
        "secret",
        "quota",
        "config",
      ].sort(),
    );
    expect([...((C.AUDIT_ACTIONS ?? []) as string[])].sort()).toEqual(
      [
        "create",
        "update",
        "delete",
        "lock",
        "unlock",
        "grant",
        "revoke",
        "restore",
        "import",
      ].sort(),
    );
  });
});

describe("ADM-FR-40 · M4-R02 · QuotaSetRequestSchema", () => {
  const item = (l: Record<string, unknown> = {}, feature_id: string | null = null) => ({
    feature_id,
    max_runs: null,
    max_tokens: null,
    max_usd: null,
    ...l,
  });
  const req = (items: unknown[]) => ({ version: 1, items });

  it("ADM-FR-40 · M4-R02 · hợp lệ: run 1000, USD '300.00'/'0.5', 100 dòng, mọi giới hạn null", () => {
    const S = C.QuotaSetRequestSchema;
    expect(ok(S, req([item({ max_runs: 1000 })]))).toBe(true);
    expect(ok(S, req([item({ max_usd: "300.00" }, U(31)), item({ max_usd: "0.5" })]))).toBe(true);
    expect(ok(S, req([item()]))).toBe(true);
    expect(
      ok(S, req(Array.from({ length: 100 }, (_, i) => item({ max_runs: 1 }, U(500 + i))))),
    ).toBe(true);
  });

  it("ADM-FR-40 · M4-R02 · từ chối max_runs 0 / 1.5; max_usd '0' / '1.234' / '-1'; 101 dòng; khoá thừa", () => {
    const S = C.QuotaSetRequestSchema;
    for (const bad of [
      { max_runs: 0 },
      { max_runs: 1.5 },
      { max_usd: "0" },
      { max_usd: "1.234" },
      { max_usd: "-1" },
    ]) {
      expect([bad, ok(S, req([item(bad)]))]).toEqual([bad, false]);
    }
    expect(
      ok(S, req(Array.from({ length: 101 }, (_, i) => item({ max_runs: 1 }, U(500 + i))))),
    ).toBe(false);
    expect(ok(S, { ...req([item({ max_runs: 1 })]), extra: 1 })).toBe(false);
    expect(ok(S, req([{ ...item({ max_runs: 1 }), warn_pct: 90 }]))).toBe(false);
  });
});

describe("ADM-FR-42 · M4-R08 · UsageReportTenantSchema", () => {
  const kpi = {
    runs: 2,
    tokens: 300,
    input_tokens: 200,
    output_tokens: 100,
    billable_usd: "0.20",
    unpriced_rows: 0,
    overage_runs: 0,
  };
  const report = {
    range: { from: "2026-10-01", to: "2026-10-31" },
    tenant_id: U(101),
    feature_id: null,
    has_data: true,
    kpi,
    previous: kpi,
    daily: [],
    top_features: [],
    top_users: [],
    quotas: [],
  };

  it("ADM-FR-42 · M4-R08 · M4-AC03 · bản tenant hợp lệ; thêm cost_usd / margin_usd ở kpi hoặc khoá tenants → bị từ chối (strict)", () => {
    const S = C.UsageReportTenantSchema;
    expect(ok(S, report)).toBe(true);
    expect(ok(S, { ...report, kpi: { ...kpi, cost_usd: "0.12" } })).toBe(false);
    expect(ok(S, { ...report, kpi: { ...kpi, margin_usd: "0.08" } })).toBe(false);
    expect(ok(S, { ...report, tenants: [] })).toBe(false);
  });
});

describe("ADM-FR-55 · M4-R17 · updated_by ở User / Tenant", () => {
  it("ADM-FR-55 · M4-R17 · UserSchema và TenantSchema có trường updated_by", () => {
    for (const name of ["UserSchema", "TenantSchema"]) {
      const shape = (C[name]?.shape ?? {}) as Record<string, unknown>;
      expect([name, Object.hasOwn(shape, "updated_by")]).toEqual([name, true]);
    }
  });
});
