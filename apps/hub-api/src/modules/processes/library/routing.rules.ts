// CR-118 §11.2 · luật thuần chọn quy trình của khe theo phòng ban người khởi tạo (không I/O).
// Luật xét theo `priority` tăng dần; luật thường khớp khi tập phòng ban của luật giao tập "phòng ban + tổ tiên" của người khởi tạo
// (luật chọn phòng cha ⇒ người ở phòng con khớp). Không luật thường nào khớp ⇒ luật `isDefault`; không có ⇒ chặn (`none`).

export type RoutingRule = {
  id: string;
  priority: number;
  condition: { departmentIds?: readonly string[] | undefined };
  defId: string;
  isDefault: boolean;
};

export type PickResult = { kind: "rule"; rule: RoutingRule } | { kind: "none" };

/** `deptAncestors`: phòng ban người khởi tạo thuộc + mọi phòng ban tổ tiên (đã gom ở SQL). Rỗng ⇒ chỉ luật mặc định áp được. */
export function pickProcess(
  rules: readonly RoutingRule[],
  deptAncestors: Iterable<string>,
): PickResult {
  const mine = new Set(deptAncestors);
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of ordered) {
    if (r.isDefault) continue;
    if ((r.condition.departmentIds ?? []).some((d) => mine.has(d)))
      return { kind: "rule", rule: r };
  }
  const def = ordered.find((r) => r.isDefault);
  return def ? { kind: "rule", rule: def } : { kind: "none" };
}
