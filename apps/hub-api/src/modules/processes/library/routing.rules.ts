// CR-118 §11.2 · luật thuần chọn quy trình của khe theo phòng ban người khởi tạo + loại HĐ (không I/O).
// Luật xét theo `priority` tăng dần; luật thường khớp khi MỌI điều kiện không rỗng khớp (AND; rỗng/vắng = mọi giá trị):
// - `departmentIds`: giao tập "phòng ban + tổ tiên" của người khởi tạo (luật chọn phòng cha ⇒ người ở phòng con khớp);
// - `contractKinds` (cr118-route-kind): chứa loại HĐ của lượt; khe không cung cấp loại (`contractKind` vắng) ⇒ bỏ qua điều kiện
//   này; khe có loại nhưng HĐ chưa có loại (`null`) ⇒ không khớp.
// Luật thường không điều kiện nào (dữ liệu lệch) ⇒ không khớp. Không luật thường nào khớp ⇒ luật `isDefault`; không có ⇒ `none`.

export type RoutingRule = {
  id: string;
  priority: number;
  condition: {
    departmentIds?: readonly string[] | undefined;
    contractKinds?: readonly string[] | undefined;
  };
  defId: string;
  isDefault: boolean;
};

/** Dữ kiện của lượt do khe cung cấp. `contractKind` vắng ⇒ khe không có khái niệm loại HĐ. */
export type RouteFacts = { contractKind?: string | null | undefined };

export type PickResult = { kind: "rule"; rule: RoutingRule } | { kind: "none" };

function matches(r: RoutingRule, mine: ReadonlySet<string>, facts: RouteFacts): boolean {
  const depts = r.condition.departmentIds ?? [];
  const kinds = r.condition.contractKinds ?? [];
  if (depts.length === 0 && kinds.length === 0) return false;
  if (depts.length > 0 && !depts.some((d) => mine.has(d))) return false;
  if (kinds.length > 0 && facts.contractKind !== undefined) {
    if (facts.contractKind === null || !kinds.includes(facts.contractKind)) return false;
  }
  return true;
}

/** `deptAncestors`: phòng ban người khởi tạo thuộc + mọi phòng ban tổ tiên (đã gom ở SQL). Rỗng ⇒ luật có phòng ban không khớp. */
export function pickProcess(
  rules: readonly RoutingRule[],
  deptAncestors: Iterable<string>,
  facts: RouteFacts = {},
): PickResult {
  const mine = new Set(deptAncestors);
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of ordered) {
    if (!r.isDefault && matches(r, mine, facts)) return { kind: "rule", rule: r };
  }
  const def = ordered.find((r) => r.isDefault);
  return def ? { kind: "rule", rule: def } : { kind: "none" };
}
