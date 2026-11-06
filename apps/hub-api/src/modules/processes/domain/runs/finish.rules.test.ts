// CR-122 · E2 · luật thuần: so dữ kiện (boolean/danh sách/trống), bước gộp, Kết thúc, lệch dữ kiện (H2).
import { describe, expect, it } from "bun:test";
import { compareFact, evaluateWhen, factKeysOf, type IfExec } from "../if/if.rules";
import { driftedIf, mergeTarget, outcomeOfStep, stagesAfter } from "./finish.rules";

describe("compareFact", () => {
  it("trống / null / danh sách rỗng ⇒ sai (nhánh Sai)", () => {
    expect(compareFact("eq", null, "x")).toBe(false);
    expect(compareFact("ne", "", "x")).toBe(false);
    expect(compareFact("ne", [], "x")).toBe(false);
    expect(compareFact("gt", undefined, 1)).toBe(false);
  });
  it("boolean so với 'true'/'false'; danh sách eq = chứa, ne = không chứa", () => {
    expect(compareFact("eq", true, "true")).toBe(true);
    expect(compareFact("eq", false, "true")).toBe(false);
    expect(compareFact("eq", ["KT", "PC"], "PC")).toBe(true);
    expect(compareFact("ne", ["KT"], "PC")).toBe(true);
    expect(compareFact("gt", ["1"], 0)).toBe(false);
  });
  it("số và chuỗi như rẽ nhánh cũ", () => {
    expect(compareFact("gt", 150_000_000, 100_000_000)).toBe(true);
    expect(compareFact("eq", "mua_hang", "mua_hang")).toBe(true);
  });
});

describe("evaluateWhen · fact", () => {
  const when = {
    op: "and" as const,
    conds: [
      { from: { kind: "fact" as const, key: "value" }, op: "gt" as const, value: 100 },
      { from: { kind: "fact" as const, key: "value" }, op: "lt" as const, value: 1000 },
      { from: { kind: "fact" as const, key: "kind" }, op: "eq" as const, value: "mua" },
    ],
  };
  it("khoá không trùng; reads ghi null khi vắng", () => {
    expect(factKeysOf(when)).toEqual(["value", "kind"]);
    expect(evaluateWhen(when, {}, {}, { value: 150 })).toEqual({
      matched: false,
      hits: [1, 2],
      reads: [
        { key: "value", value: 150 },
        { key: "kind", value: null },
      ],
    });
  });
});

describe("finish.rules", () => {
  const steps = [0, 1, 1, 2, 3];
  it("outcomeOfStep / stagesAfter", () => {
    const outs = [undefined, undefined, "approved", undefined, "rejected"];
    expect(outcomeOfStep(outs, steps, 1)).toEqual({ idx: 2, outcome: "approved" });
    expect(outcomeOfStep(outs, steps, 2)).toBeNull();
    expect(stagesAfter(steps, 1)).toEqual([3, 4]);
  });
  it("mergeTarget: lớn nhất, > bước, có thật", () => {
    expect(mergeTarget([undefined, 3, 2], steps, 1)).toBe(3);
    expect(mergeTarget([undefined, 9, 1], steps, 1)).toBeNull();
    expect(mergeTarget([], steps, 1)).toBeNull();
  });
  it("driftedIf: kết quả khác lúc rẽ ⇒ stage Nếu đầu tiên", () => {
    const ifx: IfExec = {
      when: { op: "and", conds: [{ from: { kind: "fact", key: "v" }, op: "gt", value: 100 }] },
      thenStep: 2,
      elseStep: null,
    };
    const ctx = (v: number) => ({ fieldsByStageKey: {}, inputs: {}, facts: { v } });
    const d = [{ stageIdx: 1, matched: true }];
    expect(driftedIf(d, [null, ifx], ctx(150))).toBeNull();
    expect(driftedIf(d, [null, ifx], ctx(50))).toBe(1);
  });
});
