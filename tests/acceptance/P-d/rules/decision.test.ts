// HUB-FR-115 · HUB-FR-144 · AC-H41 · PD-R14 — `domain/tasks/decision.rules.ts` (tách từ `core/task.rules.ts` ở T8s;
// plan-domain §4.16, plan-addendum A6). test-plan-rules PD-U90…U92 (U92 hồi quy PC-R10 = P-c autofix-rules H06b).
import { describe, expect, it } from "bun:test";
import { DECISION_OPTIONS, DECISION_REASONS } from "@ai/contracts/chat";
import { domainExport, domainFn, fn, PROC, tryLoad } from "../_support/modules";

const REL = "tasks/decision.rules.ts";
const ALL = ["add_attempt", "use_current", "cancel"];
const AUTOFIX = ["autofix_check_failed", "sandbox_unavailable", "apply_conflict", "apply_failed"];
/** Tập lý do có thể là Set hoặc mảng (plan chưa chốt kiểu `FORCE_USE_CURRENT`). */
const has = (c: unknown, r: string): boolean =>
  c instanceof Set ? c.has(r) : Array.isArray(c) ? c.includes(r) : false;

describe("decisionOptionsFor + timer_invalid / retry_exhausted [PD-R14, D-PD05]", () => {
  it("HUB-FR-115 · AC-H41 · PD-U90 · (false,timer_invalid) ⇒ cả 3; (false,retry_exhausted) ⇒ [add_attempt,cancel]; (true,retry_exhausted) ⇒ cả 3", async () => {
    const f = await domainFn(REL, "decisionOptionsFor");
    expect(f(false, "timer_invalid")).toEqual(ALL);
    expect(f(false, "retry_exhausted")).toEqual(["add_attempt", "cancel"]);
    expect(f(true, "retry_exhausted")).toEqual(ALL);
  });
  it("HUB-FR-115 · PD-U91 · FORCE_USE_CURRENT có timer_invalid, KHÔNG retry_exhausted; DECISION_OPTION_ORDER = DECISION_OPTIONS contract (giữ thứ tự)", async () => {
    const force = await domainExport(REL, "FORCE_USE_CURRENT");
    expect(has(force, "timer_invalid")).toBe(true);
    expect(has(force, "retry_exhausted")).toBe(false);
    expect(await domainExport(REL, "DECISION_OPTION_ORDER")).toEqual([...DECISION_OPTIONS]);
  });
});

describe("Hồi quy autofix [PC-R10, plan-addendum A6]", () => {
  it("HUB-FR-115 · PC-R10 · PD-U92 · decisionOptionsFor(hasOutput, autofix_*) = [add_attempt, cancel] kể cả hasOutput=true; job_timeout giữ nguyên", async () => {
    const f = await domainFn(REL, "decisionOptionsFor");
    for (const r of AUTOFIX) {
      expect({ r, t: f(true, r), f: f(false, r) }).toEqual({
        r,
        t: ["add_attempt", "cancel"],
        f: ["add_attempt", "cancel"],
      });
    }
    expect(f(true, "job_timeout")).toEqual([...DECISION_OPTIONS]);
    expect(f(false, "job_timeout")).toEqual(["add_attempt", "cancel"]);
  });
  it("HUB-FR-115 · PC-R10 · PD-U92 · AUTOFIX_REASONS = 4 lý do; isAutofixReason domain ≡ runs/autofix.rules (P-c, không dời) trên mọi DECISION_REASONS", async () => {
    const set = await domainExport(REL, "AUTOFIX_REASONS");
    expect([...(set as Iterable<string>)].sort()).toEqual([...AUTOFIX].sort());
    const dom = await domainFn(REL, "isAutofixReason");
    const old = fn(await tryLoad(`${PROC}/runs/autofix.rules.ts`), "isAutofixReason");
    const reasons = [...DECISION_REASONS, "timer_invalid", "retry_exhausted"];
    expect(reasons.map((r) => [r, dom(r)])).toEqual(reasons.map((r) => [r, old(r)]));
  });
});
