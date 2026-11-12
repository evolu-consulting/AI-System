// CR-127 K4 · BR-39 · khoá nội dung tự động theo TRẠNG THÁI (thay khoá theo `locked_at` + "Mở lại" của CR-097; BR-38/74 bỏ "Mở lại").
// PROCESSING (đang duyệt) và DONE (đã xong) ⇒ mọi trường pháp lý/tiền/bên/ngày/điều khoản chỉ đọc cho MỌI người (kể cả người phụ trách);
// sửa ⇒ "Tải phiên bản mới" (phiên bản v(n+1) bắt đầu ở DRAFT). DRAFT/REJECT sửa được. Không còn "sửa khi đang duyệt" (BR-39, gỡ
// `approval-edit.rules`). Vận hành vẫn ghi ở endpoint riêng: người phụ trách, đã xử lý, ghi chú, mốc/sổ (ghi việc với đối tác), tóm tắt AI.
// Thuần (lớp 1).

/** Trạng thái khoá nội dung (spec §3 · BR-39). */
export const CONTENT_LOCKED_STATUSES: ReadonlySet<string> = new Set(["processing", "done"]);

/** HĐ ở trạng thái `status` có bị khoá nội dung không. */
export const isContentLocked = (status: string): boolean => CONTENT_LOCKED_STATUSES.has(status);

/** Như `isContentLocked` nhưng giao dịch (`doc_type = 'deal'`) KHÔNG thuộc khoá K4: chứng từ nội bộ, done ngay khi tạo, BA CR-097 cho sửa
 *  mô tả trực tiếp + thêm đợt giao (quyết định điều phối CR-127 FIX-Q1c). */
export const isDocLocked = (status: string, docType?: string): boolean =>
  docType !== "deal" && isContentLocked(status);

/** Trường của `fields` vẫn sửa được khi HĐ đã khoá (lock-strict: không có). */
export const LOCK_EDITABLE_FIELDS: ReadonlySet<string> = new Set();

export type LockVerdict = "ok" | "locked";

/** Đổi `changed` trên HĐ khoá nội dung ⇒ có trường ngoài danh sách vận hành ⇒ `locked` (409, không ghi phần nào). */
export function lockVerdict(i: {
  status: string;
  docType?: string;
  changed: readonly string[];
}): LockVerdict {
  if (!isDocLocked(i.status, i.docType)) return "ok";
  return i.changed.every((k) => LOCK_EDITABLE_FIELDS.has(k)) ? "ok" : "locked";
}
