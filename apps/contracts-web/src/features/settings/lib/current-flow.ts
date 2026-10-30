// CR-105 L4 · quy trình duyệt ĐANG DÙNG (chỉ đọc): `GET /pack/contracts/approval-flow` = `ApprovalFlowCurrent`
// `{def_id, name, rel_version, is_default, steps:[{name, department_name, kind, when?}]}` (@ai/contracts). `when` dùng cho
// "Xem trước đường đi" (luật như server: giá trị trống ⇒ điều kiện đúng).
import { ApprovalFlowCurrentSchema, type FlowCond, type FlowWhen } from "@ai/contracts";

export type DealKind = "buy" | "sell" | "referral";
export type CurrentStep = {
  key: string;
  name: string;
  /** Tên phòng ban (không phải id). */
  department: string | null;
  kind: "review" | "dify" | "esign";
  when: FlowWhen | null;
};
export type CurrentFlow = {
  defId: string;
  name: string;
  version: number;
  isDefault: boolean;
  steps: CurrentStep[];
};
export type Facts = { deal: DealKind; value: number | null };

/** Thân `GET /approval-flow` ⇒ `CurrentFlow`; sai hình ⇒ null (UI báo lỗi tải). */
export function toCurrentFlow(raw: unknown): CurrentFlow | null {
  const p = ApprovalFlowCurrentSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  return {
    defId: d.def_id,
    name: d.name,
    version: d.rel_version,
    isDefault: d.is_default,
    steps: d.steps.map((s, i) => ({
      key: `s${i}`,
      name: s.name,
      department: s.department_name,
      kind: s.kind,
      when: s.when ?? null,
    })),
  };
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
