// CR-105 L4 · quy trình duyệt ĐANG DÙNG (chỉ đọc): `GET /pack/contracts/approval-flow` = `{name, rel_version, is_default, steps}`
// (design.md §4). Mapper khoan dung với hình `steps` (tên phòng ban dạng chuỗi hoặc đối tượng) vì contract L2a/L4-BE chưa chốt;
// `when` (nếu có) dùng cho "Xem trước đường đi" (luật như server: giá trị trống ⇒ điều kiện đúng).
import type { FlowCond, FlowWhen } from "@ai/contracts";

export type DealKind = "buy" | "sell" | "referral";
export type CurrentStep = {
  key: string;
  name: string;
  /** Tên phòng ban (không phải id). */
  department: string | null;
  kind: string;
  when: FlowWhen | null;
};
export type CurrentFlow = {
  name: string;
  version: number;
  isDefault: boolean;
  steps: CurrentStep[];
};
export type Facts = { deal: DealKind; value: number | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function toStep(raw: unknown, i: number): CurrentStep | null {
  if (typeof raw === "string")
    return { key: `s${i}`, name: raw, department: raw, kind: "review", when: null };
  if (!isRec(raw)) return null;
  const dept = str(raw.department_name) ?? str(raw.department) ?? str(raw.group_name);
  const name = str(raw.name) ?? dept;
  if (!name) return null;
  const when = isRec(raw.when) && Array.isArray(raw.when.conds) ? (raw.when as FlowWhen) : null;
  return {
    key: str(raw.key) ?? `s${i}`,
    name,
    department: dept,
    kind: str(raw.kind) ?? "review",
    when,
  };
}

/** Thân `GET /approval-flow` (hình mới) ⇒ `CurrentFlow`; sai hình ⇒ null (UI báo lỗi tải). */
export function toCurrentFlow(raw: unknown): CurrentFlow | null {
  if (!isRec(raw) || !Array.isArray(raw.steps)) return null;
  const name = str(raw.name);
  const version = raw.rel_version;
  if (!name || typeof version !== "number") return null;
  const steps = raw.steps.map(toStep);
  if (steps.some((s) => s === null)) return null;
  return { name, version, isDefault: raw.is_default === true, steps: steps as CurrentStep[] };
}

function cmp(op: "ge" | "gt" | "le" | "lt", v: number, t: number): boolean {
  return op === "ge" ? v >= t : op === "gt" ? v > t : op === "le" ? v <= t : v < t;
}
function hit(c: FlowCond, f: Facts): boolean {
  if (c.field === "deal") return c.in.length === 0 || c.in.includes(f.deal);
  if (f.value === null || !Number.isFinite(f.value)) return true;
  return cmp(c.op, f.value, c.value);
}
const applies = (s: CurrentStep, f: Facts): boolean => {
  const w = s.when;
  if (!w || w.conds.length === 0) return true;
  const hits = w.conds.map((c) => hit(c, f));
  return w.op === "or" ? hits.some(Boolean) : hits.every(Boolean);
};

/** Bước nào chạy / bị bỏ qua với `facts` (bước đầu luôn chạy). */
export function previewPath(steps: readonly CurrentStep[], facts: Facts): boolean[] {
  return steps.map((s, i) => i === 0 || applies(s, facts));
}
