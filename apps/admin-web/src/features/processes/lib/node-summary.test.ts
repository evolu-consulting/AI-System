import { describe, expect, test } from "bun:test";
import { emptyStage } from "./def-form";
import { kindOf, summaryOf } from "./node-summary";
import { setFromDef } from "./set-form";

const l = {
  fact: (k: string) => `F:${k}`,
  op: (o: string) => (o === "gt" ? ">" : o),
  step: (n: number) => `B${n}`,
};

describe("node-summary", () => {
  test("loại nghiệp vụ: Kết thúc theo outcome, chờ gom 3 loại, còn lại theo executor", () => {
    expect(kindOf({ executor: "set", outcome: "approved" })).toBe("finish");
    expect(kindOf({ executor: "wait_event" })).toBe("wait");
    expect(kindOf({ executor: "if" })).toBe("if");
    expect(kindOf({ executor: "agent:abc" })).toBe("agent");
  });
  test("Ghi giá trị: một dòng `trường ← nguồn` kèm số dòng còn lại", () => {
    const s = {
      ...emptyStage(2),
      executor: "set",
      set: setFromDef({
        kind: "set",
        values: [
          { key: "gia_tri", from: { kind: "fact", key: "total_value" } },
          { key: "x", from: { kind: "field", step: 1, key: "event" } },
        ],
      }),
    };
    expect(summaryOf(s, l)).toBe("gia_tri ← F:total_value (+1)");
  });
  test("Nếu: điều kiện đầu theo dữ kiện", () => {
    const s = {
      ...emptyStage(0),
      executor: "if",
      ifx: {
        op: "and" as const,
        conds: [{ from: "fact|total_value", type: "number" as const, op: "gt", value: "100" }],
        yes: 2,
        no: null,
      },
    };
    expect(summaryOf(s, l)).toBe("F:total_value > 100");
  });
});
