// HUB-FR-146 · HUB-FR-147 · AC-H44 · AC-H45 · AC-H47 · P-d2 (plan-contract §6, plan-addendum A1/A2, D2-29): schema stage
// `tool` (nguồn tham số), luật rẽ nhánh, catalog tool của editor + hàm THUẦN `toolStageIssues`/`branchStageIssues` (FE
// validate live; CÙNG điều kiện + path với luật domain — parity ở `P/adapters/defs/def-rules-parity.test.ts`).
// Không import `./processes` (file đó import file này) ⇒ không vòng import lúc chạy.
import { z } from "zod";
import {
  BRANCH_OPS,
  BRANCH_RULES_MAX,
  isIsoCalendarDate,
  PROCESS_INPUT_MAX,
  ProcessKeySchema,
  ProcessStepSchema,
  STAGE_KEY_RE,
  TOOL_ARGS_MAX,
} from "../chat/processes";
import {
  INPUT_DESC_MAX,
  INPUT_NAME_RE,
  INPUT_SCHEMA_MAX,
  InputTypeSchema,
  SELECT_OPTION_MAX,
  SELECT_OPTIONS_MAX,
} from "../common";
import { type ProcessDefIssue, resolveSteps, type StepStageShape } from "./process-steps";
import { SourceKeySchema } from "./sources";

/** Key trường output (dời từ `./processes` để file này dùng không vòng import; `./processes` re-export). */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

// ── Schema ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ArgSourceSchema = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("input"), key: SourceKeySchema }),
  z.strictObject({
    from: z.literal("field"),
    stage_key: z.string().regex(STAGE_KEY_RE),
    field: z.string().regex(FIELD_KEY_RE),
  }),
  z.strictObject({
    from: z.literal("const"),
    value: z.union([z.string().max(PROCESS_INPUT_MAX), z.number(), z.boolean()]),
  }),
]);
export type ArgSource = z.infer<typeof ArgSourceSchema>;

/** PD2-R01 · stage gọi tool (workflow catalog bật cho tenant); tên arg = tên tham số (`INPUT_NAME_RE`). */
export const ToolExecutorSchema = z.strictObject({
  kind: z.literal("tool"),
  tool_key: ProcessKeySchema,
  args: z
    .record(z.string().regex(INPUT_NAME_RE), ArgSourceSchema)
    .refine((a) => Object.keys(a).length <= TOOL_ARGS_MAX, "too many args"),
});

export const BranchRuleSchema = z.strictObject({
  field: z.string().regex(FIELD_KEY_RE),
  op: z.enum(BRANCH_OPS),
  value: z.union([z.string().max(200), z.number()]),
  goto_step: ProcessStepSchema,
});
export type BranchRule = z.infer<typeof BranchRuleSchema>;
/** `after.branch` (cả `review` và `auto`); vắng ⇒ `[]`. */
export const AfterBranchSchema = z.array(BranchRuleSchema).max(BRANCH_RULES_MAX).default([]);

export const ProcessToolParamSchema = z.strictObject({
  name: z.string().regex(INPUT_NAME_RE),
  type: InputTypeSchema,
  required: z.boolean(),
  description: z.string().max(INPUT_DESC_MAX).optional(),
  options: z.array(z.string().min(1).max(SELECT_OPTION_MAX)).max(SELECT_OPTIONS_MAX).optional(),
});
export type ProcessToolParam = z.infer<typeof ProcessToolParamSchema>;
export const ProcessToolItemSchema = z.strictObject({
  key: ProcessKeySchema,
  name: z.string().min(1).max(128),
  description: z.string().max(400),
  side_effect: z.boolean(),
  params: z
    .array(ProcessToolParamSchema)
    .max(INPUT_SCHEMA_MAX)
    .superRefine((ps, ctx) => {
      ps.forEach((p, i) => {
        if (p.options !== undefined && p.type !== "select")
          ctx.addIssue({
            code: "custom",
            path: [i, "options"],
            message: "options only for select",
          });
      });
    }),
});
export type ProcessToolItem = z.infer<typeof ProcessToolItemSchema>;

// ── Luật lưu def (plan-addendum A2) ─────────────────────────────────────────────────────────────────────────────────
/** Trần số issue mỗi hàm (= `PROCESS_DEF_PATHS_MAX`). */
const ISSUES_MAX = 20;
type FieldDraft = { key: string; type: string; required?: boolean };
type InputDraft = { key: string; type: string };
export type ToolStageDraft = StepStageShape & {
  executor: {
    kind: string;
    tool_key?: string;
    args?: Readonly<Record<string, Partial<ArgSource>>>;
  };
  answerer?: { kind: string };
  sources?: readonly unknown[];
  must_know?: readonly unknown[];
  autofix?: unknown | null;
  output?: { fields?: readonly FieldDraft[] };
};
export type ToolCatalogShape = {
  key: string;
  side_effect: boolean;
  params: readonly { name: string; type: string; required: boolean; options?: readonly string[] }[];
};
type SourceType = "string" | "number" | "date" | "boolean";

/** D2-29 · ma trận kiểu nguồn → kiểu tham số (cùng bảng với domain `tool-def.rules.ts` / FE `domain/tool-rules.ts`). */
function paramCompatible(src: SourceType, paramType: string): boolean {
  if (paramType === "number") return src === "number";
  if (paramType === "boolean") return src === "boolean";
  if (paramType === "select") return src === "string";
  if (paramType === "text" || paramType === "paragraph") return true;
  return src === paramType || src === "string";
}

/** D2-44 · kiểu nguồn của input def; `file` (và kiểu lạ) không làm nguồn ⇒ null. */
function inputSourceType(t: string): SourceType | null {
  if (t === "text" || t === "select" || t === "source_ref") return "string";
  if (t === "date" || t === "number") return t;
  return null;
}
const fieldSourceType = (t: string): SourceType | null =>
  t === "string" || t === "number" || t === "date" ? t : null;

type ArgCtx = {
  stages: readonly ToolStageDraft[];
  steps: readonly number[];
  i: number;
  inputs: readonly InputDraft[];
};

/** Kiểu nguồn của một arg; nguồn không hợp lệ (input/field không có, field không ở bước nhỏ hơn) ⇒ null. */
function argSourceType(src: Partial<ArgSource>, c: ArgCtx): SourceType | null {
  if (src.from === "const") {
    const t = typeof src.value;
    return t === "string" || t === "number" || t === "boolean" ? t : null;
  }
  if (src.from === "input") {
    const d = c.inputs.find((x) => x.key === src.key);
    return d ? inputSourceType(d.type) : null;
  }
  if (src.from !== "field") return null;
  const j = c.stages.findIndex((p) => p.key === src.stage_key);
  if (j < 0 || (c.steps[j] as number) >= (c.steps[c.i] as number)) return null;
  const f = c.stages[j]?.output?.fields?.find((x) => x.key === src.field);
  return f ? fieldSourceType(f.type) : null;
}

function argValid(
  src: Partial<ArgSource>,
  param: ToolCatalogShape["params"][number],
  c: ArgCtx,
): boolean {
  const t = argSourceType(src, c);
  if (t === null || !paramCompatible(t, param.type)) return false;
  if (param.type === "select" && src.from === "const")
    return (param.options ?? []).includes(src.value as string);
  return true;
}

/** > 20 args / tool có param `file` / sources / must_know / autofix / answerer ≠ starter ⇒ một issue `executor`. */
const toolExtraInvalid = (s: ToolStageDraft, tool: ToolCatalogShape, nArgs: number): boolean =>
  nArgs > TOOL_ARGS_MAX ||
  tool.params.some((p) => p.type === "file") ||
  (s.sources?.length ?? 0) > 0 ||
  (s.must_know?.length ?? 0) > 0 ||
  (s.autofix ?? null) !== null ||
  (s.answerer !== undefined && s.answerer.kind !== "starter");

function oneToolStage(
  s: ToolStageDraft,
  tool: ToolCatalogShape,
  c: ArgCtx,
  add: (p: string, r: ProcessDefIssue["rule"]) => void,
): void {
  const base = `stages.${c.i}`;
  const args = s.executor.args ?? {};
  const names = Object.keys(args);
  if (toolExtraInvalid(s, tool, names.length)) add(`${base}.executor`, "TOOL_INVALID");
  for (const name of names) {
    const param = tool.params.find((p) => p.name === name);
    if (!param || !argValid(args[name] as Partial<ArgSource>, param, c))
      add(`${base}.executor.args.${name}`, "TOOL_INVALID");
  }
  for (const p of tool.params)
    if (p.required && !(p.name in args)) add(`${base}.executor.args.${p.name}`, "TOOL_INVALID");
  if (tool.side_effect && !s.real_action) add(`${base}.real_action`, "TOOL_SIDE_EFFECT");
}

/** PD2-R01/R02 · chỉ stage `executor.kind === "tool"`; `tool_key ∉ tools` ⇒ KHÔNG issue (server: PROCESS_REF_INVALID). */
export function toolStageIssues(
  stages: readonly ToolStageDraft[],
  inputs: readonly InputDraft[],
  tools: ReadonlyMap<string, ToolCatalogShape>,
): ProcessDefIssue[] {
  const steps = resolveSteps(stages);
  const out: ProcessDefIssue[] = [];
  const add = (path: string, rule: ProcessDefIssue["rule"]) => out.push({ path, rule });
  stages.forEach((s, i) => {
    if (s.executor.kind !== "tool") return;
    const tool = tools.get(s.executor.tool_key ?? "");
    if (tool) oneToolStage(s, tool, { stages, steps, i, inputs }, add);
  });
  return out.slice(0, ISSUES_MAX);
}

// ── Rẽ nhánh ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type BranchStageDraft = StepStageShape & {
  output?: { fields?: readonly FieldDraft[] };
  after: StepStageShape["after"] & { branch?: readonly Partial<BranchRule>[] };
};
const ORDER_OPS: ReadonlySet<string> = new Set(["lt", "le", "gt", "ge"]);

function valueMatches(fieldType: string, v: unknown): boolean {
  if (fieldType === "number") return typeof v === "number" && Number.isFinite(v);
  if (fieldType === "date") return typeof v === "string" && isIsoCalendarDate(v);
  return typeof v === "string";
}

type BranchCtx = { stages: readonly BranchStageDraft[]; steps: readonly number[]; i: number };

/** Ô sai đầu tiên của luật theo thứ tự field → op → value → goto_step; hợp lệ ⇒ null. */
function badRuleCell(r: Partial<BranchRule>, c: BranchCtx): string | null {
  const s = c.stages[c.i] as BranchStageDraft;
  const f = s.output?.fields?.find((x) => x.key === r.field);
  if (!f) return "field";
  if (!BRANCH_OPS.includes(r.op as never) || (f.type === "string" && ORDER_OPS.has(r.op as string)))
    return "op";
  if (!valueMatches(f.type, r.value)) return "value";
  const step = c.steps[c.i] as number;
  const count = c.steps.length === 0 ? 0 : Math.max(...c.steps) + 1;
  const g = r.goto_step;
  if (typeof g !== "number" || !Number.isInteger(g) || g <= step || g >= count) return "goto_step";
  const realTarget = c.stages.some((t, k) => c.steps[k] === g && t.real_action);
  if (realTarget && s.after.kind !== "review") return "goto_step";
  return null;
}

/** PD2-R12 · BRANCH_INVALID: > 10 luật / stage không đứng một mình trong bước ⇒ `after.branch`; mỗi luật một issue. */
export function branchStageIssues(stages: readonly BranchStageDraft[]): ProcessDefIssue[] {
  const steps = resolveSteps(stages);
  const out: ProcessDefIssue[] = [];
  stages.forEach((s, i) => {
    const rules = s.after.branch ?? [];
    if (rules.length === 0) return;
    const base = `stages.${i}.after.branch`;
    const alone = steps.filter((x) => x === steps[i]).length === 1;
    if (rules.length > BRANCH_RULES_MAX || !alone) out.push({ path: base, rule: "BRANCH_INVALID" });
    rules.forEach((r, j) => {
      const cell = badRuleCell(r, { stages, steps, i });
      if (cell) out.push({ path: `${base}.${j}.${cell}`, rule: "BRANCH_INVALID" });
    });
  });
  return out.slice(0, ISSUES_MAX);
}
