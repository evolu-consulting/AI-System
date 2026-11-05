// CR-101 DOC-ui-frame · R5: dòng thời gian "Sửa trực tiếp" của giao dịch từ `GET /contracts/:id/edit-log` — nhãn trường + giá trị. Thuần.
import type { EditLogEntry } from "@ai/contracts";

/** Trường có nhãn riêng (`contracts.docframe.log.field.*`); trường khác hiện khoá thô bỏ tiền tố `fields.`. */
const KNOWN = new Set([
  "title",
  "number",
  "source",
  "partner_name",
  "start_date",
  "end_date",
  "total_value",
  "payment_terms",
  "doc_type",
  "file_id",
]);

export type LogView = {
  key: string;
  fieldKey: string | null;
  field: string;
  from: string;
  to: string;
  at: string;
};

const bare = (f: string) => (f.startsWith("fields.") ? f.slice(7) : f);

export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("vi-VN");
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  const inner = (v as { value?: unknown }).value;
  if (inner !== undefined && Object.keys(v as object).length <= 4) return valueText(inner);
  return JSON.stringify(v);
}

/** Mới nhất trước (API đã sắp); gắn khoá nhãn nếu biết. */
export function logRows(items: readonly EditLogEntry[]): LogView[] {
  return items.map((e) => {
    const f = bare(e.field);
    return {
      key: e.id,
      fieldKey: KNOWN.has(f) ? f : null,
      field: f,
      from: valueText(e.old_value),
      to: valueText(e.new_value),
      at: e.at,
    };
  });
}
