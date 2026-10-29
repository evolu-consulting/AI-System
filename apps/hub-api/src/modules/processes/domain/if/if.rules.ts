// CR-103 · fnr-if (flow-node-registry design §3): node If — đánh giá `when` (AND/OR) trong bộ nhớ trên fields đã đọc + input run,
// chọn bước đích Đúng/Sai, luật lưu def (`ifDefIssues`). Thuần, lớp 1 (kiểu tự khai — parity với contract `IfExecutorSchema`).
// Dùng lại `compare` của rẽ nhánh nên ngữ nghĩa so sánh y hệt `after.branch`.

import { compare } from "../branch/branch.rules";
import { BRANCH_OPS, type BranchOp } from "../branch/branch-def.rules";
import { isCalendarDate } from "../runs/start-inputs.rules";

/** Trần số điều kiện một node If (= `IF_CONDS_MAX` contract). */
export const IF_CONDS_MAX = 6;
type Value = string | number;
export type IfFrom =
  | { kind: "field"; stageKey: string; field: string }
  | { kind: "input"; key: string };
export type IfCond = { from: IfFrom; op: BranchOp; value: Value };
export type IfWhen = { op: "and" | "or"; conds: readonly IfCond[] };
/** `then`/`else` 0-based; `elseStep = null` ⇒ Sai thì sang bước kế. */
export type IfExec = { when: IfWhen; thenStep: number; elseStep: number | null };

/** Stage đã chuẩn hoá bước; `ifExec` ≠ null ⇒ stage là node If. */
export type IfStageShape = {
  key: string;
  step: number;
  realAction: boolean;
  afterKind: "review" | "auto";
  fields: readonly { key: string; type: string }[];
  ifExec: IfExec | null;
};
export type IfInputShape = { key: string; type: string };
export type IfDefIssue = { path: string; rule: "IF_INVALID" };

const ISSUES_MAX = 20;
const ORDER_OPS: ReadonlySet<string> = new Set(["lt", "le", "gt", "ge"]);

/** Đánh giá `when`; `hits` = số thứ tự (từ 1) các điều kiện đúng — lý do ghi vào stage. Nguồn vắng / `null` ⇒ điều kiện sai. */
export function evaluateWhen(
  when: IfWhen,
  fieldsByStageKey: Readonly<Record<string, Readonly<Record<string, Value>> | null | undefined>>,
  inputs: Readonly<Record<string, Value | null | undefined>>,
): { matched: boolean; hits: number[] } {
  const hits: number[] = [];
  when.conds.forEach((c, i) => {
    const src =
      c.from.kind === "field"
        ? (fieldsByStageKey[c.from.stageKey] ?? null)
        : (inputs as Readonly<Record<string, Value | null | undefined>>);
    const k = c.from.kind === "field" ? c.from.field : c.from.key;
    const v = src && Object.hasOwn(src, k) ? src[k] : undefined;
    if (v !== undefined && v !== null && compare(c.op, v, c.value)) hits.push(i + 1);
  });
  const matched = when.op === "and" ? hits.length === when.conds.length : hits.length > 0;
  return { matched, hits };
}

/** Bước nhảy tới: Đúng ⇒ `thenStep`; Sai ⇒ `elseStep ?? step + 1`. (`stepCount` để engine biết ≥ ⇒ run xong; ở đây chỉ chặn đích âm.) */
export function ifTarget(exec: IfExec, matched: boolean, step: number, stepCount: number): number {
  const t = matched ? exec.thenStep : (exec.elseStep ?? step + 1);
  return Number.isInteger(t) && t > step ? Math.min(t, stepCount) : step + 1;
}

function valueMatches(type: string, v: unknown): boolean {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "date") return typeof v === "string" && isCalendarDate(v);
  return typeof v === "string";
}

type Ctx = {
  stages: readonly IfStageShape[];
  inputs: readonly IfInputShape[];
  i: number;
  stepCount: number;
};

/** Ô sai đầu tiên của điều kiện theo thứ tự from → op → value; hợp lệ ⇒ null. */
function badCondCell(c: IfCond, x: Ctx): string | null {
  const s = x.stages[x.i] as IfStageShape;
  let type: string | undefined;
  if (c.from.kind === "field") {
    const f = c.from;
    const src = x.stages.find((t) => t.key === f.stageKey && t.step < s.step);
    type = src?.fields.find((d) => d.key === f.field)?.type;
  } else {
    const f = c.from;
    type = x.inputs.find((d) => d.key === f.key)?.type;
  }
  if (type === undefined) return "from";
  if (!BRANCH_OPS.includes(c.op) || (type === "string" && ORDER_OPS.has(c.op))) return "op";
  return valueMatches(type, c.value) ? null : "value";
}

/** Đích hợp lệ: nguyên, > bước If, < số bước; đích có `real_action` ⇒ bước ngay trước đích phải toàn gate review (PD2-R12). */
function targetOk(g: number, s: IfStageShape, x: Ctx): boolean {
  if (!Number.isInteger(g) || g <= s.step || g >= x.stepCount) return false;
  // Runtime (`realActionPre` + `effectivePrevStep`): bước trước có hiệu lực của đích nhảy tới = bước If (auto, không phải gate
  // review) ⇒ đích `real_action` luôn hỏng ⇒ chặn mọi đích `real_action` (cả `else_step` ngầm = bước kế).
  return !x.stages.some((t) => t.step === g && t.realAction);
}

/** IF_INVALID cho mọi stage If: đứng một mình trong bước, `after = auto`, `real_action = false`, ≤ 6 điều kiện, đích/nguồn hợp lệ. */
export function ifDefIssues(
  stages: readonly IfStageShape[],
  inputs: readonly IfInputShape[] = [],
): IfDefIssue[] {
  const stepCount = stages.length === 0 ? 0 : Math.max(...stages.map((s) => s.step)) + 1;
  const out: IfDefIssue[] = [];
  stages.forEach((s, i) => {
    const e = s.ifExec;
    if (!e) return;
    const base = `stages.${i}.executor`;
    const x: Ctx = { stages, inputs, i, stepCount };
    const alone = stages.filter((t) => t.step === s.step).length === 1;
    if (!alone || s.afterKind !== "auto" || s.realAction)
      out.push({ path: base, rule: "IF_INVALID" });
    if (e.when.conds.length < 1 || e.when.conds.length > IF_CONDS_MAX)
      out.push({ path: `${base}.when.conds`, rule: "IF_INVALID" });
    e.when.conds.forEach((c, j) => {
      const cell = badCondCell(c, x);
      if (cell) out.push({ path: `${base}.when.conds.${j}.${cell}`, rule: "IF_INVALID" });
    });
    if (!targetOk(e.thenStep, s, x)) out.push({ path: `${base}.then_step`, rule: "IF_INVALID" });
    if (!targetOk(e.elseStep ?? s.step + 1, s, x))
      out.push({ path: `${base}.else_step`, rule: "IF_INVALID" });
  });
  return out.slice(0, ISSUES_MAX);
}
