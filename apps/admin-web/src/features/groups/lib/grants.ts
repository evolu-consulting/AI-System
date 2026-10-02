// ADM-FR-32 · M3-R07, R08, R09 · tab Feature của group: hàng từ ma trận (một cột) và kế hoạch batch (hàm thuần).
import type { GrantKey, GrantMatrix, MatrixRowState } from "@ai/contracts";

export type GrantRow = {
  id: string;
  key: string;
  name: { vi: string; en?: string };
  status: "on" | "beta" | "off";
  commandNames: string[];
  commandCount: number;
  state: MatrixRowState;
  granted: boolean;
};

/** `core` tự hiệu lực (không nhận grant); `none` (chưa mở) không hiện; chỉ `entitled` sửa được; `revoked` còn grant → hàng mờ. */
export const isEditable = (r: GrantRow): boolean => r.state === "entitled";
export const isVisibleRow = (r: GrantRow): boolean => r.state !== "none";

export function toRows(matrix: GrantMatrix, groupId: string): GrantRow[] {
  return matrix.features
    .map((m) => ({
      id: m.feature.id,
      key: m.feature.key,
      name: m.feature.name,
      status: m.feature.status,
      commandNames: m.command_names,
      commandCount: m.command_count,
      state: m.state,
      granted: m.granted_group_ids.includes(groupId),
    }))
    .filter(isVisibleRow);
}

/** Hàng hiện ở chế độ xem: core, và feature đang được cấp (kể cả đã thu hồi entitlement). */
export const viewRows = (rows: GrantRow[]): GrantRow[] =>
  rows.filter((r) => r.state === "core" || r.granted);

/** Cấp những feature mới tick, thu những feature bỏ tick; chỉ xét hàng sửa được. */
export function planBatch(
  rows: readonly GrantRow[],
  selected: ReadonlySet<string>,
  groupId: string,
): { add: GrantKey[]; remove: GrantKey[] } {
  const add: GrantKey[] = [];
  const remove: GrantKey[] = [];
  for (const r of rows) {
    if (!isEditable(r)) continue;
    const want = selected.has(r.id);
    if (want && !r.granted) add.push({ feature_id: r.id, group_id: groupId });
    if (!want && r.granted) remove.push({ feature_id: r.id, group_id: groupId });
  }
  return { add, remove };
}
