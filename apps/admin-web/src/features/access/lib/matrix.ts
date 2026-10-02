// ADM-FR-35 · ADM-FR-32 · M3-R08, R09 · mô hình ma trận feature × group (hàm thuần): ô tick, nháp chênh lệch, tick hàng/cột, batch.
// Nháp là Map `featureId:groupId → giá trị mong muốn`, chỉ chứa ô KHÁC bản đã lưu (bật rồi tắt lại cùng ô → xoá khỏi nháp).
import type { GrantKey, MatrixFeature, MatrixGroup } from "@ai/contracts";
import { GRANT_BATCH_MAX } from "@ai/contracts";

export type Draft = ReadonlyMap<string, boolean>;
export type MatrixModel = {
  groups: readonly MatrixGroup[];
  features: readonly MatrixFeature[];
  /** Ô đã cấp theo server (`featureId:groupId`), gồm cả hàng đã thu hồi entitlement. */
  granted: ReadonlySet<string>;
};
export type LineState = "checked" | "mixed" | "unchecked";

export const cellKey = (featureId: string, groupId: string) => `${featureId}:${groupId}`;
/** Chỉ hàng `entitled` sửa được: `core` tự hiệu lực, `revoked` giữ nguyên (BR-12), `none` chưa mở. */
export const isEditable = (f: MatrixFeature): boolean => f.state === "entitled";
export const EMPTY_DRAFT: Draft = new Map();

export function cellChecked(
  m: Pick<MatrixModel, "granted">,
  d: Draft,
  f: MatrixFeature,
  g: MatrixGroup,
): boolean {
  if (f.state === "core") return true;
  const key = cellKey(f.feature.id, g.id);
  if (f.state === "none") return false;
  if (f.state === "revoked") return m.granted.has(key);
  return d.get(key) ?? m.granted.has(key);
}

/** Đặt giá trị mong muốn cho các ô; bằng bản đã lưu → bỏ khỏi nháp. Chỉ hàng sửa được. */
export function setCells(
  m: Pick<MatrixModel, "granted">,
  d: Draft,
  cells: ReadonlyArray<readonly [MatrixFeature, MatrixGroup]>,
  value: boolean,
): Draft {
  const next = new Map(d);
  for (const [f, g] of cells) {
    if (!isEditable(f)) continue;
    const key = cellKey(f.feature.id, g.id);
    if (value === m.granted.has(key)) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function toggleCell(m: MatrixModel, d: Draft, f: MatrixFeature, g: MatrixGroup): Draft {
  return setCells(m, d, [[f, g]], !cellChecked(m, d, f, g));
}

export function lineState(checked: number, editable: number): LineState {
  if (editable === 0 || checked === 0) return "unchecked";
  return checked === editable ? "checked" : "mixed";
}

export function rowState(m: MatrixModel, d: Draft, f: MatrixFeature): LineState {
  if (!isEditable(f)) return "unchecked";
  const checked = m.groups.filter((g) => cellChecked(m, d, f, g)).length;
  return lineState(checked, m.groups.length);
}

export function colState(m: MatrixModel, d: Draft, g: MatrixGroup): LineState {
  const rows = m.features.filter(isEditable);
  return lineState(rows.filter((f) => cellChecked(m, d, f, g)).length, rows.length);
}

/** Chưa đủ tick → bật hết ô sửa được của hàng; đã đủ → tắt hết. */
export function toggleRow(m: MatrixModel, d: Draft, f: MatrixFeature): Draft {
  return setCells(
    m,
    d,
    m.groups.map((g) => [f, g] as const),
    rowState(m, d, f) !== "checked",
  );
}

export function toggleCol(m: MatrixModel, d: Draft, g: MatrixGroup): Draft {
  const rows = m.features.filter(isEditable);
  return setCells(
    m,
    d,
    rows.map((f) => [f, g] as const),
    colState(m, d, g) !== "checked",
  );
}

/** Batch từ nháp: bỏ mục không còn hợp lệ (feature đã khoá/không còn, group không còn) hoặc không đổi so với bản đã lưu. */
export function draftToBatch(m: MatrixModel, d: Draft): { add: GrantKey[]; remove: GrantKey[] } {
  const editable = new Set(m.features.filter(isEditable).map((f) => f.feature.id));
  const groups = new Set(m.groups.map((g) => g.id));
  const add: GrantKey[] = [];
  const remove: GrantKey[] = [];
  for (const [key, value] of d) {
    const [feature_id = "", group_id = ""] = key.split(":");
    if (!editable.has(feature_id) || !groups.has(group_id) || value === m.granted.has(key))
      continue;
    (value ? add : remove).push({ feature_id, group_id });
  }
  return { add, remove };
}

export function countChanges(m: MatrixModel, d: Draft): number {
  const b = draftToBatch(m, d);
  return b.add.length + b.remove.length;
}

/** Quá `GRANT_BATCH_MAX` thao tác: chặn Lưu (không tự chia nhiều batch vì mất tính một transaction, D10). */
export const overBatchLimit = (count: number): boolean => count > GRANT_BATCH_MAX;
