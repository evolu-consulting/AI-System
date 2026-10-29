// CR-103 · fnr-if: luật lưu def node If của domain (`ifDefIssues`) ≡ contract (`ifStageIssues` FE dùng) — cùng path + rule trên cùng bộ ca.
import { describe, expect, it } from "bun:test";
import { type IfStageDraft, ifStageIssues } from "@ai/contracts/hub-admin";
import { ifDefIssues } from "../domain/if/if.rules";
import { toIfStage } from "./if-stage.map";

type Cond = { from: object; op: string; value: string | number };
const F = (field: string, op = "gt", value: string | number = 1): Cond => ({
  from: { kind: "field", stage_key: "a", field },
  op,
  value,
});
const IN = (key: string, op = "eq", value: string | number = "x"): Cond => ({
  from: { kind: "input", key },
  op,
  value,
});
const INPUTS = [{ key: "muc", type: "text" }];
function def(
  conds: Cond[],
  x: {
    thenStep?: number;
    els?: number | null;
    ifOver?: object;
    real?: boolean;
    review?: boolean;
  } = {},
) {
  const st = (key: string, step: number, o: object = {}) => ({
    key,
    step,
    real_action: false,
    after: { kind: "auto" },
    executor: { kind: "agent" },
    output: { fields: [] as { key: string; type: string }[] },
    ...o,
  });
  return [
    st("a", 0, {
      output: {
        fields: [
          { key: "tong", type: "number" },
          { key: "loai", type: "string" },
          { key: "han", type: "date" },
        ],
      },
    }),
    st("if", 1, {
      executor: {
        kind: "if",
        when: { op: "and", conds },
        then_step: x.thenStep ?? 3,
        else_step: x.els ?? null,
      },
      ...x.ifOver,
    }),
    st("b", 2, x.review ? { after: { kind: "review" } } : {}),
    st("c", 3, { real_action: x.real ?? false }),
  ];
}

const cases: [string, ReturnType<typeof def>][] = [
  ["hợp lệ", def([F("tong"), IN("muc")])],
  ["field lạ", def([F("khong")])],
  ["op thứ tự trên string", def([F("loai", "gt", "x")])],
  ["value sai kiểu number", def([F("tong", "gt", "x")])],
  ["value date sai", def([F("han", "eq", "2026-13-40")])],
  ["input lạ", def([IN("la")])],
  ["then ≤ bước If", def([F("tong")], { thenStep: 1 })],
  ["else ngoài số bước", def([F("tong")], { els: 9 })],
  ["If không một mình", def([F("tong")], { ifOver: { after: { kind: "review" } } })],
  ["real_action", def([F("tong")], { ifOver: { real_action: true } })],
  ["đích real_action, bước trước không review", def([F("tong")], { real: true })],
  ["đích real_action, bước trước review", def([F("tong")], { real: true, review: true })],
  ["7 điều kiện", def(Array.from({ length: 7 }, () => F("tong")))],
];

describe("CR-103 · ifDefIssues domain ≡ contract", () => {
  for (const [name, stages] of cases)
    it(name, () => {
      const c = ifStageIssues(stages as never as IfStageDraft[], INPUTS);
      const d = ifDefIssues(
        stages.map((s, i) => toIfStage(s as never, i)),
        INPUTS,
      );
      expect(d).toEqual(c as never);
    });
});
