// HUB-FR-143 · HUB-BR-41 · AC-H39 · AC-H40 · test-plan §4 PD-U01…U05 + test-plan-rules PD-U04b: phân loại lỗi job
// `P/domain/runs/job-error.rules.ts` (plan-domain §4.1; plan-addendum A7 Q6 — `interrupted` thắng TIMEOUT). Module vắng ⇒ đỏ "module vắng".
import { describe, expect, it } from "bun:test";
import { domainExport, domainFn } from "../_support/modules";

const REL = "runs/job-error.rules.ts";
const classify = () => domainFn(REL, "classifyJobError");
const legacy = () => domainFn(REL, "legacyFailReason");

const TRANSIENT_REASONS = [
  "timeout",
  "upstream",
  "crash",
  "orphaned",
  "provider_busy",
  "tenant_slots",
] as const;
const BUSINESS_REASONS = [
  "quota",
  "provider_unavailable",
  "cancelled",
  "invalid_payload",
  "invalid_output",
  "sandbox",
  "credential",
  "refused",
  "attachment",
  "container",
] as const;
const CODES: (string | null)[] = [
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "ALL_PROVIDERS_EXHAUSTED",
  "CANCELLED",
  "BUDGET_EXCEEDED",
  "NOT_CONFIGURED",
  "INTERNAL_ERROR",
  "WEIRD_X",
  null,
];
const REASONS: (string | null)[] = [null, ...TRANSIENT_REASONS, ...BUSINESS_REASONS, "zzz"];

/** Kỳ vọng theo bảng plan-domain §4.1: reason tạm thắng; reason null ⇒ xét code; còn lại nghiệp vụ. */
function want(code: string | null, reason: string | null): "transient" | "business" {
  if (reason !== null)
    return (TRANSIENT_REASONS as readonly string[]).includes(reason) ? "transient" : "business";
  return code === "TIMEOUT" || code === "UPSTREAM_ERROR" ? "transient" : "business";
}
const GRID = CODES.flatMap((code) =>
  REASONS.map(
    (reason) => [String(code), String(reason), code, reason, want(code, reason)] as const,
  ),
);

describe("PD-U01 · bảng phân loại 9 code × 18 reason [plan-domain §4.1]", () => {
  it("AC-H40 · PD-U01 · lưới đủ 162 ô", () => {
    expect(GRID).toHaveLength(162);
  });
  it.each(GRID)("AC-H40 · PD-U01 · code %s × reason %s", async (_c, _r, code, reason, exp) => {
    expect((await classify())(code, reason)).toBe(exp);
  });
});

describe("PD-U02…U05 · classifyJobError / legacyFailReason [plan-domain §4.1, A7 Q6]", () => {
  it("AC-H39 · PD-U02 · reason tạm thắng code: INTERNAL_ERROR+crash, ALL_PROVIDERS_EXHAUSTED+provider_busy ⇒ transient; +quota ⇒ business", async () => {
    const f = await classify();
    expect([
      f("INTERNAL_ERROR", "crash"),
      f("ALL_PROVIDERS_EXHAUSTED", "provider_busy"),
      f("ALL_PROVIDERS_EXHAUSTED", "quota"),
    ]).toEqual(["transient", "transient", "business"]);
  });
  it("HUB-BR-41 · PD-U03 · TRANSIENT_JOB_REASONS đúng 6, TRANSIENT_JOB_CODES đúng 2", async () => {
    const reasons = await domainExport(REL, "TRANSIENT_JOB_REASONS");
    const codes = await domainExport(REL, "TRANSIENT_JOB_CODES");
    expect([...reasons].sort()).toEqual([...TRANSIENT_REASONS].sort());
    expect([...codes].sort()).toEqual(["TIMEOUT", "UPSTREAM_ERROR"]);
  });
  it("AC-H40 · PD-U04 · legacyFailReason: TIMEOUT ⇒ job_timeout; UPSTREAM_ERROR ⇒ agent_failed; interrupted ⇒ interrupted; INTERNAL_ERROR ⇒ agent_failed", async () => {
    const f = await legacy();
    expect([
      f({ code: "TIMEOUT", interrupted: false }),
      f({ code: "UPSTREAM_ERROR", interrupted: false }),
      f({ code: null, interrupted: true }),
      f({ code: "INTERNAL_ERROR", interrupted: false }),
    ]).toEqual(["job_timeout", "agent_failed", "interrupted", "agent_failed"]);
  });
  it("AC-H40 · PD-U04b · interrupted thắng TIMEOUT (A7 Q6)", async () => {
    const f = await legacy();
    expect([
      f({ code: "TIMEOUT", interrupted: true }),
      f({ code: "TIMEOUT", interrupted: false }),
      f({ code: null, interrupted: true }),
    ]).toEqual(["interrupted", "job_timeout", "interrupted"]);
  });
  it("HUB-BR-41 · PD-U05 · thuần: gọi 2 lần cùng kết quả; chuỗi rỗng ('','') ⇒ business", async () => {
    const f = await classify();
    for (const [c, r] of [
      ["TIMEOUT", null],
      ["INTERNAL_ERROR", "crash"],
      ["WEIRD_X", "zzz"],
    ] as const)
      expect(f(c, r)).toBe(f(c, r));
    expect(f("", "")).toBe("business");
  });
});
