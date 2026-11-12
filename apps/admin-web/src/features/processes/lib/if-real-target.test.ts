// CR-127 · EO4 · nhánh Nếu đi thẳng tới bước hành động thật (Ký số) ⇒ câu riêng nói lý do + cách sửa (không phải câu chung IF_INVALID).
import { describe, expect, test } from "bun:test";
import { d2LiveErrors, IF_ERR, IF_REAL_ERR } from "./d2-validate";
import type { StageDraft } from "./draft-types";
import { emptyIf } from "./if-form";
import { emptyStage } from "./stage-convert";

const st = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  key,
  name: key,
  step,
  filename: `${key}.md`,
  template: "x",
  sections: ["Kết quả"],
  ...p,
});
const cond = { from: "fact:total_value", type: "number" as const, op: "gt" as const, value: "5" };
// Duyệt(0) → Nếu(1: Đúng → Duyệt(2), Sai → bước 3) → [bước 3]
const flow = (yes: number, no: number | null, real: boolean): StageDraft[] => [
  st("duyet", 0, { after: "review", groupId: "g" }),
  st("neu", 1, { executor: "if", after: "auto", ifx: { ...emptyIf(), conds: [cond], yes, no } }),
  st("duyet-kt", 2, { after: "review", groupId: "g" }),
  st("ky-so", 3, { real }),
];
const at = (e: Record<string, string>, f: string) => e[`stages.1.executor.${f}`];

describe("ifErrors · nhánh tới bước hành động thật", () => {
  test("Sai (hoặc Đúng) đi thẳng tới Ký số ⇒ IF_REAL_ERR, không phải câu chung", () => {
    const e = d2LiveErrors(flow(3, 4, true), [], []);
    expect(at(e, "else_step")).toBe(IF_REAL_ERR);
    expect(at(e, "then_step")).toBeUndefined();
  });
  test("«Sai» để trống = bước kế; bước kế là hành động thật ⇒ cũng IF_REAL_ERR", () => {
    const stages = [flow(3, null, false)[1] as StageDraft].map((x) => ({ ...x, step: 0 }));
    const real = st("ky-so", 1, { real: true });
    const e = d2LiveErrors([...stages, real], [], []);
    expect(e["stages.0.executor.else_step"]).toBe(IF_REAL_ERR);
  });
  test("không bước nào là hành động thật ⇒ không lỗi nhánh", () => {
    const e = d2LiveErrors(flow(3, 4, false), [], []);
    expect(at(e, "else_step")).toBeUndefined();
  });
  test("lỗi khác (đích không sau bước Nếu) vẫn là câu chung IF_ERR", () => {
    const e = d2LiveErrors(flow(1, 4, false), [], []);
    expect(at(e, "then_step")).toBe(IF_ERR);
  });
});
