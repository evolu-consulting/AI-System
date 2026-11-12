// CR-127 · E7 · BR-17 · "Thử nhanh các nhánh": 4 trường hợp dựng từ ngưỡng của node Nếu — Duyệt hết (nhánh Đúng), Duyệt hết (nhánh Sai),
// một bước Từ chối, một bước Trả lại. Dữ kiện mẫu sinh từ chính điều kiện của node Nếu; kết quả đi qua CÙNG `walkFlow` (không đường riêng).
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import type { FactValue, IfCond } from "../if/if.rules";
import {
  type Decision,
  type PreviewInput,
  type PreviewResult,
  walkFlow,
} from "./flow-preview.walk";

export type ScenarioKey = "approve_then" | "approve_else" | "reject" | "return";
export type Scenario = {
  key: ScenarioKey;
  label: string;
  facts: Record<string, FactValue>;
  decisions: Decision[];
  result: PreviewResult;
};

const NEG: Record<string, IfCond["op"]> = {
  eq: "ne",
  ne: "eq",
  lt: "ge",
  ge: "lt",
  le: "gt",
  gt: "le",
};
const asNum = (v: unknown): number | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const other = (v: IfCond["value"]): FactValue =>
  typeof v === "boolean" ? !v : typeof v === "number" ? v + 1 : `${v}_khac`;

/** Giá trị dữ kiện làm điều kiện `c` Đúng (`want=true`) hoặc Sai (`want=false`). Vế phải không phải số mà phép so thứ tự ⇒ giữ nguyên. */
export function valueFor(c: IfCond, want: boolean): FactValue {
  const op = want ? c.op : (NEG[c.op] as IfCond["op"]);
  if (op === "eq") return c.value;
  if (op === "ne") return other(c.value);
  const n = asNum(c.value);
  if (n === null) return c.value as FactValue;
  return op === "gt" ? n + 1 : op === "lt" ? n - 1 : n;
}

type Exec = {
  kind: string;
  when?: {
    op: "and" | "or";
    conds: { from: { kind: string; key?: string }; op: string; value: IfCond["value"] }[];
  };
};

/** Dữ kiện đưa mọi node Nếu sang nhánh Đúng/Sai: AND-Đúng = mọi vế đúng, AND-Sai = vế đầu sai; OR-Đúng = vế đầu đúng, OR-Sai = mọi vế sai. */
export function factsFor(
  stages: readonly ProcessStageDef[],
  base: Readonly<Record<string, FactValue>>,
  then: boolean,
): Record<string, FactValue> {
  const out: Record<string, FactValue> = { ...base };
  const set = new Set<string>();
  for (const s of stages) {
    const e = s.executor as unknown as Exec;
    if (e.kind !== "if" || !e.when) continue;
    const all = e.when.op === "and" ? then : !then; // true ⇒ đặt mọi vế theo `then`; false ⇒ chỉ vế đầu
    e.when.conds.forEach((c, i) => {
      const key = c.from.kind === "fact" ? c.from.key : undefined;
      if (!key || set.has(key) || (!all && i > 0)) return;
      set.add(key);
      out[key] = valueFor(
        { from: { kind: "fact", key }, op: c.op as IfCond["op"], value: c.value },
        then,
      );
    });
  }
  return out;
}

const hasFactIf = (stages: readonly ProcessStageDef[]): boolean =>
  stages.some((s) => {
    const e = s.executor as unknown as Exec;
    return e.kind === "if" && (e.when?.conds ?? []).some((c) => c.from.kind === "fact");
  });

/** Duyệt từng bước đang chờ cho tới khi hết đường (trần 30 lần). `last` = quyết định cuối của bước cuối cùng được thay (Từ chối/Trả lại). */
export function approveAll(
  i: Omit<PreviewInput, "decisions">,
  upTo?: { key: string; result: Decision["result"] },
) {
  const decisions: Decision[] = [];
  for (let n = 0; n < 30; n++) {
    const result = walkFlow({ ...i, decisions });
    const w = result.waiting_step;
    if (result.status !== "waiting" || !w) return { decisions, result };
    decisions.push({ step_key: w, result: upTo?.key === w ? upTo.result : "approve" });
    if (upTo?.key === w) return { decisions, result: walkFlow({ ...i, decisions }) };
  }
  return { decisions, result: walkFlow({ ...i, decisions }) };
}

export function scenariosOf(i: Omit<PreviewInput, "decisions">): Scenario[] {
  const out: Scenario[] = [];
  const mk = (
    key: ScenarioKey,
    label: string,
    facts: Record<string, FactValue>,
    upTo?: { key: string; result: Decision["result"] },
  ) => {
    const r = approveAll({ ...i, facts }, upTo);
    out.push({ key, label, facts, ...r });
  };
  const yes = factsFor(i.stages, i.facts, true);
  mk("approve_then", "Duyệt hết · các nhánh Nếu đi bên Đúng", yes);
  if (hasFactIf(i.stages))
    mk("approve_else", "Duyệt hết · các nhánh Nếu đi bên Sai", factsFor(i.stages, i.facts, false));
  const reviews = out[0]?.result.path.filter((p) => p.kind === "review") ?? [];
  const last = reviews.at(-1);
  const first = reviews[0];
  if (last) mk("reject", `${last.name} Từ chối`, yes, { key: last.step_key, result: "reject" });
  if (first) mk("return", `${first.name} Trả lại`, yes, { key: first.step_key, result: "return" });
  return out;
}
