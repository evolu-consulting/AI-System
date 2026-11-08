// CR-125 · «Quy trình con» — luật THUẦN (lớp 1): kết quả lượt con ⇒ đầu ra node, dữ liệu lượt con ⇒ field `sub_<trường>` của bước cha,
// nối đầu vào lượt con từ dữ liệu lượt cha, đồ thị gọi (vòng / độ sâu). Không I/O.

export type ChildOutcome = "done" | "rejected" | "cancelled";
/** `failed` ⇒ bước cha «Cần xử lý» như tool lỗi (không phải một đầu ra). */
export type ChildSettle = { kind: "outcome"; outcome: ChildOutcome } | { kind: "failed" };

const REJECT_RE = /(reject|declin|refus|tu_choi|tu-choi)/;

/** Trạng thái lượt con + kết quả node Kết thúc (nếu có) + quyết định Duyệt cuối ⇒ cách chốt bước cha. */
export function childSettle(c: {
  status: string;
  endOutcome: string | null;
  lastDecision: string | null;
}): ChildSettle | null {
  if (c.status === "cancelled") return { kind: "outcome", outcome: "cancelled" };
  if (c.status === "failed" || c.status === "expired") return { kind: "failed" };
  if (c.status !== "done") return null;
  if (c.endOutcome !== null) {
    const o = c.endOutcome.toLowerCase();
    return { kind: "outcome", outcome: REJECT_RE.test(o) ? "rejected" : "done" };
  }
  return { kind: "outcome", outcome: c.lastDecision === "rejected" ? "rejected" : "done" };
}

export const SUB_PREFIX = "sub_";
const FIELD_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** Field cuối của lượt con (đã gộp theo thứ tự bước) ⇒ `sub_<trường>` (chỉ giá trị vô hướng, khoá hợp lệ). */
export function subFields(
  child: Readonly<Record<string, unknown>>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(child)) {
    const key = `${SUB_PREFIX}${k}`;
    if (!FIELD_RE.test(key)) continue;
    if (typeof v === "string" || typeof v === "number") out[key] = v;
    else if (typeof v === "boolean") out[key] = v ? "true" : "false";
  }
  return out;
}

export type ParentData = {
  /** field output hiện hành theo mã bước. */
  byStageKey: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
  inputs: Readonly<Record<string, string | number>>;
};

/**
 * `input_map` (đầu vào con ← id nguồn `autoMapInputs`: `<khoá>` = đầu vào lượt cha, `<mã bước>:<trường>` = output bước trước) ⇒ giá trị;
 * nguồn không có dữ liệu ⇒ bỏ qua (luật đầu vào con quyết).
 */
export function mappedValues(
  map: Readonly<Record<string, string>> | undefined,
  p: ParentData,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [childKey, id] of Object.entries(map ?? {})) {
    const colon = id.indexOf(":");
    const v = colon < 0 ? p.inputs[id] : p.byStageKey[id.slice(0, colon)]?.[id.slice(colon + 1)];
    if (v !== undefined && v !== null && String(v).length > 0) out[childKey] = String(v);
  }
  return out;
}

export type CallIssue = { kind: "cycle" | "depth"; chain: string[] };

/**
 * Đồ thị gọi từ `root` (khoá def đang lưu, cạnh = khoá quy trình con của mỗi def): quay về `root` ⇒ vòng; chuỗi dài hơn `max` cạnh ⇒ sâu.
 * `edges` thiếu khoá ⇒ lá. Duyệt theo chiều sâu, dừng khi gặp lỗi đầu tiên.
 */
export function callIssue(
  root: string,
  edges: ReadonlyMap<string, readonly string[]>,
  max: number,
): CallIssue | null {
  const walk = (key: string, chain: string[]): CallIssue | null => {
    for (const next of edges.get(key) ?? []) {
      const c = [...chain, next];
      if (next === root || chain.includes(next)) return { kind: "cycle", chain: c };
      if (c.length - 1 > max) return { kind: "depth", chain: c };
      const deeper = walk(next, c);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(root, [root]);
}
