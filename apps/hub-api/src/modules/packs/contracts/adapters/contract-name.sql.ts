// CR-121 F-5 · MỘT định nghĩa "tên HĐ" cho SQL: trường "Tên hợp đồng" (`fields.title`), trống ⇒ cột `title` (tên file lúc tải lên).
// Dùng chung cho dữ kiện HĐ của lượt duyệt (`difyFacts` ⇒ input Dify + mẫu Thông báo {ten_hd}), nhãn bản ghi (Q-1) và mọi chỗ đọc tên HĐ (Q-4).
// Chặn tái phát: `bun run check:contract-name` (không tự viết lại biểu thức này ở nơi khác).
import { sql } from "drizzle-orm";

const ALIAS_RE = /^[a-z][a-z0-9_]{0,15}$/;

const titleField = (alias: string) => `nullif(btrim(${alias}.fields -> 'title' ->> 'value'), '')`;
const nameExpr = (alias: string) => `coalesce(${titleField(alias)}, ${alias}.title)`;
const checked = (fn: string, alias: string) => {
  if (!ALIAS_RE.test(alias)) throw new Error(`${fn}: bí danh không hợp lệ`);
  return alias;
};

/** Biểu thức tên HĐ của bí danh bảng `contracts.contracts` (vd `c`). Văn bản cố định theo bí danh (không dữ liệu người dùng). */
export function contractNameSql(alias: string) {
  return sql.raw(nameExpr(checked("contractNameSql", alias)));
}

/**
 * CR-121 Q-4 · "nhãn hiển thị" cho danh sách việc/sổ cái/hẹn nhắc: tên HĐ, thiếu ⇒ mã HĐ (`number`), thiếu nữa ⇒ tên file.
 * Bí danh phải có cột `number`, `fields`, `title` của `contracts.contracts`.
 */
export function contractLabelSql(alias: string) {
  const a = checked("contractLabelSql", alias);
  return sql.raw(`coalesce(${titleField(a)}, ${a}.number, ${a}.title)`);
}

/** CR-121 Q-4 · "mã trước" cho thông báo/sổ cái: mã HĐ (`number`), thiếu ⇒ tên HĐ (`contractNameSql`). */
export function contractCodeSql(alias: string) {
  const a = checked("contractCodeSql", alias);
  return sql.raw(`coalesce(${a}.number, ${nameExpr(a)})`);
}
