// Luật thuần duyệt trên engine: facts rẽ nhánh, bước review áp dụng cuối (CR-127 Z3b: gỡ test route/finalize máy cũ).
import { describe, expect, it } from "bun:test";
import { factsOf, finalizesOnApprove } from "./approval-engine.rules";
import type { FlowStep } from "./approval-flow.rules";

const G = "00000000-0000-4000-8000-0000000000a1";
const review = (key: string, when: unknown = null): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: G,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when,
  }) as FlowStep;
const BIG = { op: "and", conds: [{ field: "total_value", op: "ge", value: 1000 }] };
const TWO = [review("l1"), review("l2", BIG)];

describe("factsOf / finalizesOnApprove", () => {
  it("loại HĐ lạ ⇒ null", () => {
    expect(factsOf("lease", 1)).toEqual({ deal: null, total_value: 1 });
    expect(factsOf("buy", 1)).toEqual({ deal: "buy", total_value: 1 });
  });
  it("finalizesOnApprove: bước review áp dụng cuối", () => {
    expect(finalizesOnApprove(TWO, factsOf("buy", 10), 0)).toBe(true);
    expect(finalizesOnApprove(TWO, factsOf("buy", 5000), 0)).toBe(false);
    expect(finalizesOnApprove(TWO, factsOf("buy", 5000), 1)).toBe(true);
  });
});
