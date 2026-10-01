// ADM-FR-20, ADM-FR-30 · M2 · lọc/giới hạn danh sách chọn của RefPicker (hàm thuần).
import { foldKeyInput } from "@/lib/normalize";

export const PICKER_LIMIT = 50;

export type PickerOption = { id: string; label: string; hint?: string };

/** Bỏ mục đã chọn, lọc theo `query` (không phân biệt hoa thường/dấu), cắt còn `limit`; `more` = số mục bị cắt. */
export function visibleOptions(
  options: readonly PickerOption[],
  selectedIds: readonly string[] | undefined,
  query: string,
  limit: number = PICKER_LIMIT,
): { shown: PickerOption[]; more: number } {
  const taken = new Set(selectedIds);
  const q = foldKeyInput(query.trim());
  const matched = options.filter(
    (o) => !taken.has(o.id) && (q === "" || foldKeyInput(`${o.label} ${o.hint ?? ""}`).includes(q)),
  );
  return { shown: matched.slice(0, limit), more: Math.max(0, matched.length - limit) };
}

/** Di chuyển mục đang chọn bằng ↑/↓, không vòng. `count` = 0 → -1. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  return Math.min(count - 1, Math.max(0, current + delta));
}
