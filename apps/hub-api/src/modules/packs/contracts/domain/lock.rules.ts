// CR-097 K1 · HD-FR-100 khoá cứng sau xác nhận (thay D3-13 "sửa sau duyệt ⇒ mở lại duyệt") · HD-FR-104 owner mở lại có lý do. Thuần.
// HĐ đã khoá: mọi trường pháp lý (số, tên, bên, ngày, tiền, điều khoản) chỉ đọc cho MỌI người (kể cả owner) — muốn sửa thì owner
// "Mở lại" (về Chờ duyệt, có log) hoặc tải bản cập nhật (K2). Vận hành vẫn sửa ở endpoint riêng: người phụ trách, đã xử lý, ghi chú,
// mốc/sổ (ghi việc với đối tác), gắn SP cho dòng hàng, tóm tắt AI. Trong nhóm 23 trường chỉ `notice_days` (số ngày báo trước — dùng
// cho nhắc hạn HD4) là vận hành.
// CR-097 lock-strict (2026-10-23): người dùng chốt KHOÁ TUYỆT ĐỐI — `notice_days` cũng chỉ đọc; thêm/sửa/xoá mốc, gắn SP, gắn HĐ gốc ⇒ 409.
// Chỉ còn thao tác vận hành: giao việc, ghi nhận xử lý, xác nhận xong mốc, hoãn/nhắc, ghi việc với đối tác, tóm tắt AI.

/** Trường của `fields` vẫn sửa được khi HĐ đã khoá. */
export const LOCK_EDITABLE_FIELDS: ReadonlySet<string> = new Set();

export type LockVerdict = "ok" | "locked";

/** Đổi `changed` trên HĐ `locked` ⇒ có trường ngoài danh sách vận hành ⇒ `locked` (409, không ghi phần nào). */
export function lockVerdict(i: { locked: boolean; changed: readonly string[] }): LockVerdict {
  if (!i.locked) return "ok";
  return i.changed.every((k) => LOCK_EDITABLE_FIELDS.has(k)) ? "ok" : "locked";
}

export type ReopenVerdict = "ok" | "not_locked";

/** Chỉ HĐ đang khoá mới mở lại được (quyền owner do route chặn, lý do do schema). */
export const reopenVerdict = (i: { locked: boolean }): ReopenVerdict =>
  i.locked ? "ok" : "not_locked";
