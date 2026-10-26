// atomic-confirm (người dùng 2026-10-24): tenant TẮT duyệt — "Xác nhận và lưu" = ghi nháp (không khoá) ⇒ hộp "Gắn sản phẩm" (HĐ có
// dòng) ⇒ MỘT `POST /review` mang `products`: xác nhận + khoá + gắn/tạo SP trong cùng tx. Không còn gọi product-links sau khi khoá.
import type { ProductLink, ReviewSaveRequest } from "@ai/contracts";
import { afterConfirm } from "~/features/contract-approval/lib/approval";

/** Thân lệnh xác nhận: chỉ `version` (+ `products` khi có lựa chọn) — trường/dòng đã ghi ở bước nháp. */
export const confirmSaveBody = (
  version: number,
  products: readonly ProductLink[],
): ReviewSaveRequest => (products.length ? { version, products: [...products] } : { version });

/** prod-fix · bước "lưu trước" của MỌI nút xác nhận (thẻ duyệt lẫn "Xác nhận và lưu"): màn xác nhận sau AI đọc ⇒ CHỈ ghi nháp
 *  (không bao giờ chốt/khoá HĐ — kể cả khi tenant tắt duyệt mà máy chủ còn lượt duyệt cũ); chốt chỉ ở lệnh sau hộp "Gắn sản phẩm".
 *  HĐ thường ⇒ PATCH ô đã đổi. */
export const firstSaveMode = (confirmStep: boolean): "draft" | "patch" =>
  confirmStep ? "draft" : "patch";

/** HĐ không có dòng ⇒ xác nhận thẳng, không hộp. */
export const needsLinkDialog = (items: number): boolean => items > 0;

/** Kết quả lệnh xác nhận ⇒ cùng luật hộp của confirm-flow: thành công đóng + tải lại; HĐ đã đổi / không còn chờ xác nhận ⇒ đóng +
 *  tải lại; lỗi khác (vd SP không hợp lệ) ⇒ giữ hộp để sửa lựa chọn. */
export function afterConfirmSave(r: { ok: true } | { ok: false; code: string | null }) {
  if (r.ok) return afterConfirm({ ok: true, step: null });
  const gone = r.code === "REVIEW_NOT_ALLOWED" || r.code === "CONTRACT_STALE";
  return afterConfirm({ ok: false, code: gone ? "APPROVAL_NOT_OPEN" : r.code });
}
