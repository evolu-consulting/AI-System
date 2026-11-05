// CR-121 F-5 · MỘT định nghĩa "tên HĐ" cho SQL: trường "Tên hợp đồng" (`fields.title`), trống ⇒ cột `title` (tên file lúc tải lên).
// Dùng chung cho dữ kiện HĐ của lượt duyệt (`difyFacts` ⇒ input Dify + mẫu Thông báo {ten_hd}) và nhãn bản ghi (Q-1).
import { sql } from "drizzle-orm";

const ALIAS_RE = /^[a-z][a-z0-9_]{0,15}$/;

/** Biểu thức tên HĐ của bí danh bảng `contracts.contracts` (vd `c`). Văn bản cố định theo bí danh (không dữ liệu người dùng). */
export function contractNameSql(alias: string) {
  if (!ALIAS_RE.test(alias)) throw new Error("contractNameSql: bí danh không hợp lệ");
  return sql.raw(nameExpr(alias));
}

const nameExpr = (alias: string) =>
  `coalesce(nullif(btrim(${alias}.fields -> 'title' ->> 'value'), ''), ${alias}.title)`;

/**
 * CR-121 Q-4 · "nhãn" gọn của HĐ cho thông báo/nhật ký: mã HĐ (`number`) nếu có, thiếu ⇒ tên HĐ (`contractNameSql`).
 * Bí danh phải có cột `number`, `fields`, `title` của `contracts.contracts`.
 */
export function contractLabelSql(alias: string) {
  if (!ALIAS_RE.test(alias)) throw new Error("contractLabelSql: bí danh không hợp lệ");
  return sql.raw(`coalesce(${alias}.number, ${nameExpr(alias)})`);
}
