// CR-103 · fnr-if (flow-node-registry design §3): node `if` — điều kiện AND/OR trên field output của stage bước trước hoặc input
// của run, rẽ Đúng/Sai theo bước. Chỉ khai báo kiểu (đợt này chưa đưa vào union `executor` của `./processes` — đợt wiring làm).
// Không import `./processes` (file đó sẽ import file này) ⇒ không vòng import lúc chạy.
import { z } from "zod";
import { BRANCH_OPS, isIsoCalendarDate, ProcessStepSchema, STAGE_KEY_RE } from "../chat/processes";
import { type ProcessDefIssue, resolveSteps } from "./process-steps";
import { FIELD_KEY_RE } from "./process-tools";
import { SourceKeySchema } from "./sources";

/** Số điều kiện tối thiểu / tối đa của một node If. */
export const IF_CONDS_MIN = 1;
export const IF_CONDS_MAX = 6;
/** Độ dài tối đa giá trị so sánh dạng chuỗi (= `BranchRuleSchema.value`). */
export const IF_VALUE_MAX = 200;

export const CondFromSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("field"),
    stage_key: z.string().regex(STAGE_KEY_RE),
    field: z.string().regex(FIELD_KEY_RE),
  }),
  z.strictObject({ kind: z.literal("input"), key: SourceKeySchema }),
]);
export type CondFrom = z.infer<typeof CondFromSchema>;

export const CondSchema = z.strictObject({
  from: CondFromSchema,
  op: z.enum(BRANCH_OPS),
  value: z.union([z.string().max(IF_VALUE_MAX), z.number()]),
});
export type Cond = z.infer<typeof CondSchema>;

export const WhenSchema = z.strictObject({
  op: z.enum(["and", "or"]),
  conds: z.array(CondSchema).min(IF_CONDS_MIN).max(IF_CONDS_MAX),
});
export type When = z.infer<typeof WhenSchema>;

/** `then_step`/`else_step` 0-based (như `goto_step`); `else_step = null` ⇒ Sai thì sang bước kế. */
export const IfExecutorSchema = z.strictObject({
  kind: z.literal("if"),
  when: WhenSchema,
  then_step: ProcessStepSchema,
  else_step: ProcessStepSchema.nullable(),
});
export type IfExecutor = z.infer<typeof IfExecutorSchema>;

// ── Luật lưu def (FE validate live; CÙNG điều kiện + path với `ifDefIssues` domain — parity ở `defs/if-def-parity.test.ts`) ──
const ORDER_OPS: ReadonlySet<string> = new Set(["lt", "le", "gt", "ge"]);
/** Hình stage mà `ifStageIssues` cần (bản nháp FE / def đã parse). */
export type IfStageDraft = {
  key: string;
  step?: number;
  real_action: boolean;
  after: { kind: string };
  executor: { kind: string } & Partial<Omit<IfExecutor, "kind">>;
  output?: { fields?: readonly { key: string; type: string }[] };
};
type IfInputDraft = { key: string; type: string };

function valueMatches(type: string, v: unknown): boolean {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "date") return typeof v === "string" && isIsoCalendarDate(v);
  return typeof v === "string";
}

type IfCtx = {
  stages: readonly IfStageDraft[];
  steps: readonly number[];
  inputs: readonly IfInputDraft[];
  i: number;
};

function badCondCell(c: Cond, x: IfCtx): string | null {
  const own = x.steps[x.i] as number;
  let type: string | undefined;
  if (c.from.kind === "field") {
    const f = c.from;
    const k = x.stages.findIndex((t, j) => t.key === f.stage_key && (x.steps[j] as number) < own);
    type = x.stages[k]?.output?.fields?.find((d) => d.key === f.field)?.type;
  } else {
    const f = c.from;
    type = x.inputs.find((d) => d.key === f.key)?.type;
  }
  if (type === undefined) return "from";
  if (!BRANCH_OPS.includes(c.op) || (type === "string" && ORDER_OPS.has(c.op))) return "op";
  return valueMatches(type, c.value) ? null : "value";
}

function targetOk(g: unknown, x: IfCtx): boolean {
  const own = x.steps[x.i] as number;
  const count = x.steps.length === 0 ? 0 : Math.max(...x.steps) + 1;
  if (typeof g !== "number" || !Number.isInteger(g) || g <= own || g >= count) return false;
  // Khớp runtime (`effectivePrevStep`): bước trước có hiệu lực của đích nhảy tới là bước If (auto) ⇒ đích `real_action` bị chặn.
  return !x.stages.some((t, k) => x.steps[k] === g && t.real_action);
}

/** IF_INVALID cho stage `executor.kind = "if"`: một mình trong bước, `after = auto`, `real_action = false`, ≤ 6 điều kiện, nguồn/đích hợp lệ. */
export function ifStageIssues(
  stages: readonly IfStageDraft[],
  inputs: readonly IfInputDraft[] = [],
): ProcessDefIssue[] {
  const steps = resolveSteps(stages);
  const out: ProcessDefIssue[] = [];
  const add = (path: string) => out.push({ path, rule: "IF_INVALID" });
  stages.forEach((s, i) => {
    const e = s.executor;
    if (e.kind !== "if") return;
    const base = `stages.${i}.executor`;
    const x: IfCtx = { stages, steps, inputs, i };
    const alone = steps.filter((v) => v === steps[i]).length === 1;
    if (!alone || s.after.kind !== "auto" || s.real_action) add(base);
    const conds = e.when?.conds ?? [];
    if (conds.length < IF_CONDS_MIN || conds.length > IF_CONDS_MAX) add(`${base}.when.conds`);
    conds.forEach((c, j) => {
      const cell = badCondCell(c, x);
      if (cell) add(`${base}.when.conds.${j}.${cell}`);
    });
    if (!targetOk(e.then_step, x)) add(`${base}.then_step`);
    if (!targetOk(e.else_step ?? (steps[i] as number) + 1, x)) add(`${base}.else_step`);
  });
  return out.slice(0, 20);
}
