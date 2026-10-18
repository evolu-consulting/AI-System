// HUB-FR-146 · AC-H44 · PD2-R01/R02 · D2-14 · D2-29 · plan-d2-rules §1–§2, plan-addendum A2: luật lưu def cho stage `tool`
// (cùng điều kiện + path với `toolStageIssues` của contract — parity `adapters/defs/tool-def-parity.test.ts`). Thuần, lớp 1.
import type { ArgSource } from "../tools/tool-run.rules";

/** Trần số tham số một stage tool (= `TOOL_ARGS_MAX` contract). */
export const TOOL_ARGS_MAX = 20;
const ISSUES_MAX = 20;

export type ToolParamShape = {
  name: string;
  type: string;
  required: boolean;
  options?: readonly string[];
};
export type ToolDefShape = { key: string; sideEffect: boolean; params: readonly ToolParamShape[] };
export type ToolInputShape = { key: string; type: string };
/** Stage đã chuẩn hoá bước (`step` = `resolveSteps`). `tool` null ⇒ không phải stage tool. */
export type ToolStageShape = {
  key: string;
  step: number;
  realAction: boolean;
  fields: readonly { key: string; type: string }[];
  tool: { toolKey: string; args: Readonly<Record<string, ArgSource>> } | null;
  /** Trường không dùng được cho stage tool (A2): số nguồn / must_know, có tự-sửa, người trả lời ≠ starter. */
  extras: { sources: number; mustKnow: number; autofix: boolean; answererKind: string };
};
export type ToolDefIssue = { path: string; rule: "TOOL_INVALID" | "TOOL_SIDE_EFFECT" };
type SourceType = "string" | "number" | "date" | "boolean";

/** D2-29 · ma trận kiểu nguồn → kiểu tham số (plan-d2-rules §2; BE ≡ FE ≡ contract). */
export function paramCompatible(sourceType: SourceType, paramType: string): boolean {
  if (paramType === "number") return sourceType === "number";
  if (paramType === "boolean") return sourceType === "boolean";
  if (paramType === "select") return sourceType === "string";
  if (paramType === "text" || paramType === "paragraph") return true;
  return sourceType === paramType || sourceType === "string";
}

/** D2-44 · kiểu nguồn của input def; `file`/lạ ⇒ null. */
function inputSourceType(t: string): SourceType | null {
  if (t === "text" || t === "select" || t === "source_ref") return "string";
  return t === "date" || t === "number" ? t : null;
}
const fieldSourceType = (t: string): SourceType | null =>
  t === "string" || t === "number" || t === "date" ? t : null;

type Ctx = { stages: readonly ToolStageShape[]; i: number; inputs: readonly ToolInputShape[] };

/** Kiểu nguồn; nguồn không hợp lệ (input/field không có, field không ở bước nhỏ hơn) ⇒ null. */
function argSourceType(src: ArgSource, c: Ctx): SourceType | null {
  if (src.from === "const") {
    const t = typeof src.value;
    return t === "string" || t === "number" || t === "boolean" ? t : null;
  }
  if (src.from === "input") {
    const d = c.inputs.find((x) => x.key === src.key);
    return d ? inputSourceType(d.type) : null;
  }
  const from = c.stages.find((p) => p.key === src.stageKey);
  const me = c.stages[c.i] as ToolStageShape;
  if (!from || from.step >= me.step) return null;
  const f = from.fields.find((x) => x.key === src.field);
  return f ? fieldSourceType(f.type) : null;
}

function argValid(src: ArgSource, p: ToolParamShape, c: Ctx): boolean {
  const t = argSourceType(src, c);
  if (t === null || !paramCompatible(t, p.type)) return false;
  if (p.type === "select" && src.from === "const")
    return (p.options ?? []).includes(src.value as string);
  return true;
}

const extraInvalid = (s: ToolStageShape, tool: ToolDefShape, nArgs: number): boolean =>
  nArgs > TOOL_ARGS_MAX ||
  tool.params.some((p) => p.type === "file") ||
  s.extras.sources > 0 ||
  s.extras.mustKnow > 0 ||
  s.extras.autofix ||
  s.extras.answererKind !== "starter";

function oneStage(s: ToolStageShape, tool: ToolDefShape, c: Ctx, out: ToolDefIssue[]): void {
  const base = `stages.${c.i}`;
  const args = s.tool?.args ?? {};
  const names = Object.keys(args);
  if (extraInvalid(s, tool, names.length))
    out.push({ path: `${base}.executor`, rule: "TOOL_INVALID" });
  for (const name of names) {
    const p = tool.params.find((x) => x.name === name);
    if (!p || !argValid(args[name] as ArgSource, p, c))
      out.push({ path: `${base}.executor.args.${name}`, rule: "TOOL_INVALID" });
  }
  for (const p of tool.params)
    if (p.required && !(p.name in args))
      out.push({ path: `${base}.executor.args.${p.name}`, rule: "TOOL_INVALID" });
  if (tool.sideEffect && !s.realAction)
    out.push({ path: `${base}.real_action`, rule: "TOOL_SIDE_EFFECT" });
}

/** PD2-R01/R02 · chỉ stage tool; `toolKey ∉ tools` ⇒ KHÔNG issue (server trả `PROCESS_REF_INVALID`). Cắt 20. */
export function toolStageIssues(
  stages: readonly ToolStageShape[],
  inputs: readonly ToolInputShape[],
  tools: ReadonlyMap<string, ToolDefShape>,
): ToolDefIssue[] {
  const out: ToolDefIssue[] = [];
  stages.forEach((s, i) => {
    const tool = s.tool ? tools.get(s.tool.toolKey) : undefined;
    if (tool) oneStage(s, tool, { stages, i, inputs }, out);
  });
  return out.slice(0, ISSUES_MAX);
}
