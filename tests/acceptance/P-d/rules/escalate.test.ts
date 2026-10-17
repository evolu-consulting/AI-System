// HUB-FR-145 · HUB-BR-43 · HUB-BR-25 · AC-H42 · PD-R20/R22 — `domain/notify/escalate.rules.ts` `dueEscalation`,
// `escalateAction` (plan-domain §4.14, plan §4.9). test-plan-rules PD-U82, PD-U83.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "notify/escalate.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");
const H1 = new Date("2026-10-19T00:00:00.000Z");
const G2 = "a5d00000-0000-4000-8000-0000000000a2";
const TA = "a5d00000-0000-4000-8000-00000000e001"; // tenant của task
const TB = "a5d00000-0000-4000-8000-00000000e002"; // tenant khác

describe("dueEscalation [PD-R20]", () => {
  it("HUB-FR-145 · AC-H42 · PD-U82 · review open + escalateAt ≤ now + chưa chuyển ⇒ true; đã chuyển / kind ask / closed / escalateAt null ⇒ false", async () => {
    const f = await domainFn(REL, "dueEscalation");
    const t = { kind: "review", status: "open", escalateAt: H1, escalatedAt: null };
    expect(f(t, N)).toBe(true);
    expect(f({ ...t, escalateAt: N }, N)).toBe(true);
    expect(f({ ...t, escalatedAt: H1 }, N)).toBe(false);
    expect(f({ ...t, kind: "ask" }, N)).toBe(false);
    expect(f({ ...t, status: "closed" }, N)).toBe(false);
    expect(f({ ...t, escalateAt: null }, N)).toBe(false);
    expect(f({ ...t, escalateAt: new Date("2026-10-19T02:00:00.000Z") }, N)).toBe(false);
  });
});

describe("escalateAction [PD-R20, PD-R22 — cách ly tenant]", () => {
  it("HUB-BR-43 · HUB-BR-25 · PD-U83 · Group còn + cùng tenant ⇒ add_group; không tồn tại / khác tenant / groupTenantId null ⇒ skip", async () => {
    const f = await domainFn(REL, "escalateAction");
    const p = { groupId: G2, groupExists: true, groupTenantId: TA, taskTenantId: TA };
    expect(f(p)).toEqual({ kind: "add_group", groupId: G2 });
    expect(f({ ...p, groupExists: false, groupTenantId: null })).toEqual({ kind: "skip" });
    expect(f({ ...p, groupTenantId: TB })).toEqual({ kind: "skip" });
    expect(f({ ...p, groupTenantId: null })).toEqual({ kind: "skip" });
  });
});
