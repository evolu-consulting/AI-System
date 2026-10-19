// HD-FR-06 · HD-AC06 · HD1 T9 (spec-decisions D-T9b): dữ liệu event `field_edited` = `{changes}`. Mỗi giá trị chuỗi cắt còn
// ≤ `EVENT_TEXT_MAX` ký tự (+ "…") để event luôn qua CHECK `octet_length(data::text) ≤ 65536` kể cả khi sửa đủ 23 khoá × 2000
// ký tự (lịch sử chỉ để xem; giá trị đầy đủ nằm ở `fields`). Thuần.
import type { FieldChange, FieldValue } from "./fields.rules";

/** 23 khoá × 2 giá trị × 200 ký tự × ≤ 6 byte (thoát JSON `\uXXXX`) ≈ 55 KB < 64 KiB. */
export const EVENT_TEXT_MAX = 200;

/** Cắt theo điểm mã (không tách cặp surrogate ⇒ jsonb không từ chối). */
function clip(v: FieldValue): FieldValue {
  if (typeof v !== "string" || v.length <= EVENT_TEXT_MAX) return v;
  const cps = Array.from(v);
  return cps.length <= EVENT_TEXT_MAX ? v : `${cps.slice(0, EVENT_TEXT_MAX).join("")}…`;
}

export function editEventData(changes: readonly FieldChange[]): { changes: FieldChange[] } {
  return { changes: changes.map((c) => ({ key: c.key, old: clip(c.old), new: clip(c.new) })) };
}
