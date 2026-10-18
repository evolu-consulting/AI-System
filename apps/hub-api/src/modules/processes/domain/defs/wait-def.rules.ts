// HUB-FR-144 · PD-R17 · plan-domain §4.6 (+ addendum A2): luật lưu def cho stage `wait_until`. Thuần, lớp 1.
export type WaitFrom =
  | { kind: "input"; key: string }
  | { kind: "field"; stageKey: string; field: string };
export type WaitFieldShape = { key: string; type: string };
/** Hình tối thiểu của stage cho luật (adapter dựng từ def). */
export type WaitStageShape = {
  key: string;
  step: number;
  realAction: boolean;
  after: "review" | "auto";
  executorKind: string;
  hasSources: boolean;
  hasMustKnow: boolean;
  hasAutofix: boolean;
  wait: { from: WaitFrom; offsetDays: number; time: string } | null;
  fields: readonly WaitFieldShape[];
};
export type WaitInputShape = { key: string; type: string };
export type WaitDefIssue = { path: string; rule: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function sourceOk(
  from: WaitFrom,
  s: WaitStageShape,
  stages: readonly WaitStageShape[],
  inputs: readonly WaitInputShape[],
): boolean {
  if (from.kind === "input") return inputs.some((x) => x.key === from.key && x.type === "date");
  const src = stages.find((x) => x.key === from.stageKey && x.step < s.step);
  return !!src?.fields.some((f) => f.key === from.field && f.type === "date");
}

const offsetOk = (n: number): boolean => Number.isInteger(n) && n >= -365 && n <= 365;

function stagePaths(
  s: WaitStageShape,
  stages: readonly WaitStageShape[],
  inputs: readonly WaitInputShape[],
): string[] {
  const paths: string[] = [];
  if (s.after !== "auto") paths.push("after");
  if (s.realAction || s.hasSources || s.hasMustKnow || s.hasAutofix) paths.push("executor");
  const w = s.wait;
  if (!w) return [...paths, "executor.from"];
  if (!sourceOk(w.from, s, stages, inputs)) paths.push("executor.from");
  if (!offsetOk(w.offsetDays)) paths.push("executor.offset_days");
  if (!TIME_RE.test(w.time)) paths.push("executor.time");
  return paths;
}

/** WAIT_INVALID: after≠auto | realAction | hasSources | hasMustKnow | hasAutofix | nguồn input không có/không `date` |
 *  nguồn field: stage_key không ở bước NHỎ HƠN hoặc field không có/không `date` | offset_days ∉ −365…365 | time sai. */
export function waitStageIssues(
  stages: readonly WaitStageShape[],
  inputs: readonly WaitInputShape[],
): WaitDefIssue[] {
  const out: WaitDefIssue[] = [];
  for (const [i, s] of stages.entries()) {
    if (s.executorKind !== "wait_until") continue;
    for (const path of stagePaths(s, stages, inputs))
      out.push({ path: `stages.${i}.${path}`, rule: "WAIT_INVALID" });
  }
  return out;
}
