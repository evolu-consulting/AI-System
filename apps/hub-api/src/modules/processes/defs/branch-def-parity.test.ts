// HUB-FR-147 · PD2-R10…R12 · plan-addendum A2: luật lưu def `after.branch` của domain (`branch-def.rules`) ≡ contract
// (`branchStageIssues` FE dùng) — cùng path + rule trên cùng bộ ca.
import { describe, expect, it } from "bun:test";
import { branchStageIssues as contractIssues } from "@ai/contracts/hub-admin";
import { type BranchOp, branchStageIssues } from "../domain/branch/branch-def.rules";

type Rule = { field: string; op: string; value: string | number; goto_step: number };
type Draft = {
  key: string;
  step: number;
  real_action: boolean;
  after: { kind: string; branch: Rule[] };
  output: { fields: { key: string; type: string; required: boolean }[] };
};
const FIELDS = [
  { key: "tong", type: "number", required: true },
  { key: "loai", type: "string", required: true },
  { key: "han", type: "date", required: true },
];
const R: Rule = { field: "tong", op: "gt", value: 10, goto_step: 3 };
function def(rules: Rule[], o: Partial<Draft> = {}, extra: Draft[] = []): Draft[] {
  const st = (key: string, step: number, x: Partial<Draft> = {}): Draft => ({
    key,
    step,
    real_action: false,
    after: { kind: "auto", branch: [] },
    output: { fields: [] },
    ...x,
  });
  return [
    st("s0", 0),
    st("s1", 1, { after: { kind: "review", branch: rules }, output: { fields: FIELDS }, ...o }),
    ...extra,
    st("s2", 2),
    st("s3", 3, { real_action: true }),
    st("s4", 4),
  ];
}
const toDomain = (s: Draft) => ({
  step: s.step,
  realAction: s.real_action,
  afterKind: s.after.kind as "review" | "auto",
  fields: s.output.fields,
  branch: s.after.branch.map((r) => ({ ...r, op: r.op as BranchOp, gotoStep: r.goto_step })),
});

const CASES: [string, Draft[]][] = [
  ["hợp lệ", def([R])],
  ["11 luật", def(Array.from({ length: 11 }, () => R))],
  ["bước song song", def([R], {}, [{ ...def([])[0], key: "p", step: 1 } as Draft])],
  ["field vắng", def([{ ...R, field: "x" }])],
  ["op thứ tự với string", def([{ ...R, field: "loai", op: "lt", value: "a" }])],
  ["op lạ", def([{ ...R, op: "like" }])],
  ["value khác kiểu", def([{ ...R, value: "abc" }])],
  ["date sai lịch", def([{ ...R, field: "han", op: "lt", value: "2026-02-30" }])],
  ["date đúng", def([{ ...R, field: "han", op: "lt", value: "2026-02-28" }])],
  ["goto = step", def([{ ...R, goto_step: 1 }])],
  ["goto ≥ số bước", def([{ ...R, goto_step: 5 }])],
  ["đích real_action, after auto", def([R], { after: { kind: "auto", branch: [R] } })],
];

describe("HUB-FR-147 · branchStageIssues domain ≡ contract", () => {
  for (const [name, stages] of CASES)
    it(name, () => {
      const c = contractIssues(stages as never);
      expect(branchStageIssues(stages.map(toDomain))).toEqual(c as never);
    });
  it("ca sai có issue (không so trống với trống)", () => {
    expect(branchStageIssues(def([{ ...R, goto_step: 1 }]).map(toDomain))).toEqual([
      { path: "stages.1.after.branch.0.goto_step", rule: "BRANCH_INVALID" },
    ]);
  });
});
