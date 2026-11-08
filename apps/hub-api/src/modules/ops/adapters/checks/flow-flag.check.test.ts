// CR-125 · G8 · unit: đánh giá check `flow_flag` (thuần): 0 công ty lệch ⇒ ok; còn ⇒ warn nêu tên (tối đa 5) + số còn lại + cách xử lý.
import { describe, expect, it } from "bun:test";
import { evaluateFlowFlag } from "./flow-flag.check";

describe("flow_flag · evaluateFlowFlag", () => {
  it("không công ty nào lệch ⇒ ok", () => {
    const r = evaluateFlowFlag({ n: 0, sample: [] });
    expect([r.status, r.value]).toEqual(["ok", { count: 0 }]);
  });

  it("có công ty lệch ⇒ warn nêu tên + hint; quá 5 tên ⇒ 'và N nữa'", () => {
    const r = evaluateFlowFlag({ n: 7, sample: ["A", "B", "C", "D", "E"] });
    expect(r.status).toBe("warn");
    expect(r.message).toContain("7 công ty");
    expect(r.message).toContain("A, B, C, D, E và 2 nữa");
    expect(r.hint).toContain("Lưu và áp dụng");
    expect(evaluateFlowFlag({ n: 1, sample: ["A"] }).message).not.toContain("nữa");
  });
});
