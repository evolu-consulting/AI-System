// CR-120 · HĐ nháp / không quyền xem: hub trả 404 (hoặc 403) thô ("Not found") — hiện MỘT câu chung, không lộ HĐ có tồn tại hay không.
export const NOT_VISIBLE_KEY = "contracts.review.notVisible";
/** Mã không đúng dạng (hub 400 "Invalid request") ⇒ câu dịch dễ hiểu, không lộ chữ thô tiếng Anh. */
export const NOT_FOUND_KEY = "contracts.review.notFound";

/** Khoá i18n thay cho lỗi thô khi mở HĐ không thấy được; lỗi khác ⇒ null (giữ câu lỗi gốc). */
export function detailErrorKey(e: unknown): string | null {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 400 || status === 422) return NOT_FOUND_KEY;
  return status === 404 || status === 403 ? NOT_VISIBLE_KEY : null;
}
