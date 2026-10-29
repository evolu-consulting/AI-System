// CR-103 · R3 fnr-swap · design §2: luật đổi loại node — thuần, dùng chung FE/BE (BE vẫn kiểm lại khi lưu bằng `def.rules`).
// Cùng họ VÀ mọi field mà def dùng từ stage này vẫn được khai báo (output.fields giữ nguyên khi đổi; `produces: "none"` ⇒ không được có tham chiếu).
import { type ExecutorKind, NODE_PRODUCES, nodeFamily } from "./node-family";
import type { ProcessStageDef } from "./processes";

/** Một tham chiếu tới field của stage khác. `by` = key stage đang dùng; `via` = nơi dùng. */
export type FieldRef = {
  by: string;
  field: string;
  via: "branch" | "wait_from" | "tool_arg" | "cond";
};

export type CanSwap = { ok: true } | { ok: false; reason: "family" | "field_ref"; detail: string };

type Loose = { kind: string; from?: unknown; args?: unknown; when?: unknown };
type Fld = { field: string };
const isFieldFrom = (x: unknown, key: string): x is Fld => {
  const o = x as { kind?: string; from?: string; stage_key?: string } | null;
  return !!o && (o.kind === "field" || o.from === "field") && o.stage_key === key;
};
const mk = (by: string, via: FieldRef["via"], f: Fld): FieldRef => ({ by, field: f.field, via });

/** Tham chiếu field tới `key` của MỘT stage khác. Thêm loại node có tham chiếu field ⇒ thêm một nhánh ở đây. */
function refsOfStage(s: ProcessStageDef, key: string): FieldRef[] {
  const ex = s.executor as Loose;
  const out: FieldRef[] = [];
  if (ex.kind === "wait_until" && isFieldFrom(ex.from, key))
    out.push(mk(s.key, "wait_from", ex.from));
  if (ex.kind === "tool")
    for (const a of Object.values((ex.args ?? {}) as Record<string, unknown>))
      if (isFieldFrom(a, key)) out.push(mk(s.key, "tool_arg", a));
  // node `if` (R2): when.conds[].from
  for (const c of (ex.when as { conds?: { from?: unknown }[] } | undefined)?.conds ?? [])
    if (isFieldFrom(c.from, key)) out.push(mk(s.key, "cond", c.from));
  return out;
}

/** Mọi tham chiếu field tới stage `stageKey`: luật rẽ nhánh của chính nó + stage khác dùng nó. */
export function fieldRefsTo(
  def: { stages: readonly ProcessStageDef[] },
  stageKey: string,
): FieldRef[] {
  return def.stages.flatMap((s) =>
    s.key === stageKey
      ? (s.after.branch ?? []).map((r) => mk(s.key, "branch", r))
      : refsOfStage(s, stageKey),
  );
}
/** Stage `stageIdx` có đổi được sang loại `newKind` không. */
export function canSwap(
  def: { stages: readonly ProcessStageDef[] },
  stageIdx: number,
  newKind: ExecutorKind,
): CanSwap {
  const s = def.stages[stageIdx];
  if (!s) return { ok: false, reason: "family", detail: String(stageIdx) };
  const from = nodeFamily(s.executor.kind);
  if (from === null || from !== nodeFamily(newKind))
    return { ok: false, reason: "family", detail: `${s.executor.kind}>${newKind}` };
  const refs = fieldRefsTo(def, s.key);
  const declared = new Set(s.output.fields.map((f) => f.key));
  const bad = refs.find((r) => NODE_PRODUCES[newKind] === "none" || !declared.has(r.field));
  return bad
    ? { ok: false, reason: "field_ref", detail: `${bad.by}.${bad.via}:${bad.field}` }
    : { ok: true };
}
