// HUB-FR-144 · HUB-BR-42 · AC-H41 · test-plan §4 PD-U31: trần run đang chạy không đếm `waiting_timer`
// `P/domain/runs/active-cap.rules.ts` (plan-domain §4.5, PD-R16). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainExport, domainFn } from "../_support/modules";

const REL = "runs/active-cap.rules.ts";
const COUNTED = ["running", "waiting_review", "waiting_answer", "needs_decision"];
const ALL = [...COUNTED, "waiting_timer", "done", "cancelled", "failed", "expired"];

describe("PD-U31 · active-cap [plan-domain §4.5]", () => {
  it("AC-H41 · PD-U31 · CAP_COUNTED đúng 4 trạng thái (không waiting_timer)", async () => {
    expect([...(await domainExport(REL, "CAP_COUNTED"))].sort()).toEqual([...COUNTED].sort());
  });
  it.each(ALL)("AC-H41 · PD-U31 · %s: countsTowardCap / isActive", async (s) => {
    const counts = await domainFn(REL, "countsTowardCap");
    const active = await domainFn(REL, "isActive");
    expect({ s, counts: counts(s), active: active(s) }).toEqual({
      s,
      counts: COUNTED.includes(s),
      active: COUNTED.includes(s) || s === "waiting_timer",
    });
  });
});
