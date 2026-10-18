// ADM-FR-71 · HUB-FR-143 · P-d1 · luật form "Chờ tới ngày" (PD-R13/R17 phía form). Thuần, built-in (ADR-0023).
import { WAIT_OFFSET_DAYS, WAIT_TIME_RE } from "./limits";

export type DateSource =
  | { kind: "input"; key: string; label: string }
  | { kind: "field"; stageKey: string; stageName: string; n: number; field: string };

type InputLite = { key: string; label: string; type: string };
type StageLite = {
  key: string;
  name: string;
  step: number;
  fields: { key: string; type: string }[];
};

/** Nguồn ngày hợp lệ cho giai đoạn ở bước `step`: input kiểu date + field kiểu date của giai đoạn ở bước nhỏ hơn. */
export function dateSources(
  inputs: readonly InputLite[],
  stages: readonly StageLite[],
  step: number,
): DateSource[] {
  const out: DateSource[] = [];
  for (const i of inputs)
    if (i.type === "date") out.push({ kind: "input", key: i.key, label: i.label });
  stages.forEach((s, idx) => {
    if (s.step >= step) return;
    for (const f of s.fields)
      if (f.type === "date")
        out.push({ kind: "field", stageKey: s.key, stageName: s.name, n: idx + 1, field: f.key });
  });
  return out;
}

/** Giá trị `Select`: `input:<key>` | `field:<stageKey>:<field>`. */
export function sourceValue(s: DateSource): string {
  return s.kind === "input" ? `input:${s.key}` : `field:${s.stageKey}:${s.field}`;
}

export function parseSourceValue(
  v: string,
): { kind: "input"; key: string } | { kind: "field"; stageKey: string; field: string } | null {
  const p = v.split(":");
  if (p[0] === "input" && p.length === 2 && p[1]) return { kind: "input", key: p[1] };
  if (p[0] === "field" && p.length === 3 && p[1] && p[2])
    return { kind: "field", stageKey: p[1], field: p[2] };
  return null;
}

/** Câu tóm tắt: âm = trước, 0 = đúng ngày, dương = sau. */
export function offsetDirection(days: number): { dir: "before" | "on" | "after"; abs: number } {
  if (days === 0) return { dir: "on", abs: 0 };
  return { dir: days < 0 ? "before" : "after", abs: Math.abs(days) };
}

export type WaitFormIssues = { source?: "required" | "invalid"; offset?: "range"; time?: "format" };

export function waitIssues(
  f: { source: string; offset: string; time: string },
  sources: readonly DateSource[],
): WaitFormIssues {
  const out: WaitFormIssues = {};
  if (f.source === "") out.source = "required";
  else if (!sources.some((s) => sourceValue(s) === f.source)) out.source = "invalid";
  const o = f.offset.trim();
  const n = Number(o);
  if (!/^-?\d+$/.test(o) || n < WAIT_OFFSET_DAYS.min || n > WAIT_OFFSET_DAYS.max)
    out.offset = "range";
  if (!WAIT_TIME_RE.test(f.time)) out.time = "format";
  return out;
}
