// CR-103 · fnr-if: luật thuần node If — đánh giá when (AND/OR), chọn bước đích, kiểm def (IF_INVALID).
import { describe, expect, it } from "bun:test";
import {
  evaluateWhen,
  type IfCond,
  type IfExec,
  type IfStageShape,
  ifDefIssues,
  ifTarget,
} from "./if.rules";

const fld = (field: string, op: IfCond["op"], value: string | number): IfCond => ({
  from: { kind: "field", stageKey: "a", field },
  op,
  value,
});
const inp = (key: string, op: IfCond["op"], value: string | number): IfCond => ({
  from: { kind: "input", key },
  op,
  value,
});
const FIELDS = { a: { tong: 150, loai: "mua" } };

describe("evaluateWhen", () => {
  const cases: [string, "and" | "or", IfCond[], boolean, number[]][] = [
    ["and đều đúng", "and", [fld("tong", "gt", 100), fld("loai", "eq", "mua")], true, [1, 2]],
    ["and một sai", "and", [fld("tong", "gt", 100), fld("loai", "eq", "ban")], false, [1]],
    ["or một đúng", "or", [fld("tong", "lt", 1), inp("muc", "eq", "x")], true, [2]],
    ["or đều sai", "or", [fld("tong", "lt", 1), inp("muc", "eq", "y")], false, []],
    ["field vắng ⇒ sai", "and", [fld("khong", "eq", 1)], false, []],
    [
      "stage nguồn chưa có fields ⇒ sai",
      "and",
      [{ ...fld("tong", "eq", 1), from: { kind: "field", stageKey: "z", field: "tong" } }],
      false,
      [],
    ],
    ["số lưu dạng chuỗi so với số", "and", [inp("n", "ge", 5)], true, [1]],
  ];
  for (const [name, op, conds, matched, hits] of cases)
    it(name, () => {
      const r = evaluateWhen({ op, conds }, FIELDS, { muc: "x", n: "7" });
      expect(r).toEqual({ matched, hits });
    });
});

describe("ifTarget", () => {
  const ex: IfExec = { when: { op: "and", conds: [] }, thenStep: 4, elseStep: 2 };
  it("Đúng ⇒ then; Sai ⇒ else; else null ⇒ bước kế", () => {
    expect(ifTarget(ex, true, 1, 6)).toBe(4);
    expect(ifTarget(ex, false, 1, 6)).toBe(2);
    expect(ifTarget({ ...ex, elseStep: null }, false, 1, 6)).toBe(2);
    expect(ifTarget({ ...ex, thenStep: 9 }, true, 1, 6)).toBe(6);
  });
});

describe("ifDefIssues", () => {
  const st = (key: string, step: number, o: Partial<IfStageShape> = {}): IfStageShape => ({
    key,
    step,
    realAction: false,
    afterKind: "auto",
    fields: [],
    ifExec: null,
    ...o,
  });
  const ok: IfExec = {
    when: { op: "and", conds: [fld("tong", "gt", 1)] },
    thenStep: 3,
    elseStep: null,
  };
  const base = (ifExec: IfExec, over: Partial<IfStageShape> = {}, extra: IfStageShape[] = []) => [
    st("a", 0, {
      fields: [
        { key: "tong", type: "number" },
        { key: "loai", type: "string" },
      ],
    }),
    st("if", 1, { ifExec, ...over }),
    st("b", 2),
    st("c", 3),
    ...extra,
  ];
  const paths = (s: IfStageShape[]) =>
    ifDefIssues(s, [{ key: "muc", type: "string" }]).map((i) => i.path);

  const cases: [string, IfStageShape[], string[]][] = [
    ["hợp lệ", base(ok), []],
    ["then ≤ bước If", base({ ...ok, thenStep: 1 }), ["stages.1.executor.then_step"]],
    ["then vượt số bước", base({ ...ok, thenStep: 4 }), ["stages.1.executor.then_step"]],
    ["else sai", base({ ...ok, elseStep: 0 }), ["stages.1.executor.else_step"]],
    ["If không đứng một mình", base(ok, {}, [st("p", 1)]), ["stages.1.executor"]],
    ["after review", base(ok, { afterKind: "review" }), ["stages.1.executor"]],
    ["real_action", base(ok, { realAction: true }), ["stages.1.executor"]],
    [
      "nguồn không ở bước nhỏ hơn",
      base({
        ...ok,
        when: {
          op: "or",
          conds: [
            { ...fld("tong", "gt", 1), from: { kind: "field", stageKey: "c", field: "tong" } },
          ],
        },
      }),
      ["stages.1.executor.when.conds.0.from"],
    ],
    [
      "op thứ tự trên string",
      base({ ...ok, when: { op: "and", conds: [fld("loai", "gt", "x")] } }),
      ["stages.1.executor.when.conds.0.op"],
    ],
    [
      "value sai kiểu",
      base({ ...ok, when: { op: "and", conds: [fld("tong", "gt", "x")] } }),
      ["stages.1.executor.when.conds.0.value"],
    ],
    [
      "input không khai báo",
      base({ ...ok, when: { op: "and", conds: [inp("lạ", "eq", "x")] } }),
      ["stages.1.executor.when.conds.0.from"],
    ],
    [
      "quá 6 điều kiện",
      base({
        ...ok,
        when: { op: "and", conds: Array.from({ length: 7 }, () => fld("tong", "gt", 1)) },
      }),
      ["stages.1.executor.when.conds"],
    ],
    [
      "đích then real_action (bước trước đích không phải gate review)",
      base(ok, {}, []).map((s) => (s.key === "c" ? { ...s, realAction: true } : s)),
      ["stages.1.executor.then_step"],
    ],
    [
      "đích then real_action dù bước trước đích là gate review (runtime: bước trước có hiệu lực = If)",
      base(ok).map((s) =>
        s.key === "c"
          ? { ...s, realAction: true }
          : s.key === "b"
            ? { ...s, afterKind: "review" as const }
            : s,
      ),
      ["stages.1.executor.then_step"],
    ],
    [
      "đích else ngầm (bước kế) real_action",
      base(ok).map((s) => (s.key === "b" ? { ...s, realAction: true } : s)),
      ["stages.1.executor.else_step"],
    ],
  ];
  for (const [name, stages, want] of cases) it(name, () => expect(paths(stages)).toEqual(want));
});
