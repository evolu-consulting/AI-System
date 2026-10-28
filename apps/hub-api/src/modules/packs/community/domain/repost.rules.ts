// COM-C11a · nghiep-vu §7 "Đăng lại dưới tên mình": bài đối tác → bản nháp của chủ quản. Thuần, không mạng/DB.
import type { LeakStatus } from "./image-check.rules";
// Nội dung chuẩn hoá (bỏ SĐT/email/link/MST/tên công ty khác), KHÔNG mang người đăng gốc, giá để trống cho chủ quản đặt,
// ảnh bị đánh suspect mặc định loại trừ (chủ quản bật lại sau khi đọc cảnh báo; unknown/clean giữ).
import { scanContacts, stripContacts } from "./mask.rules";

export type RepostSourceImage = { ref: string; leakStatus: LeakStatus };
export type RepostSource = {
  product: string;
  quantity: number | null;
  body: string;
  images: readonly RepostSourceImage[];
  // Người đăng gốc có thể có trong nguồn nhưng KHÔNG được sao chép — cố ý không khai báo ở đây.
};
export type RepostDraftImage = { ref: string; leakStatus: LeakStatus; included: boolean };
export type RepostDraft = {
  product: string;
  quantity: number | null;
  body: string;
  /** Để trống: chủ quản tự đặt giá. */
  price: null;
  images: RepostDraftImage[];
  /** Có ảnh suspect ⇒ UI cảnh báo trước khi chủ quản bật dùng (không chặn). */
  hasSuspectImages: boolean;
};

export function buildRepostDraft(
  src: RepostSource,
  ctx: { otherCompanies?: readonly string[] } = {},
): RepostDraft {
  const sc = ctx.otherCompanies ? { otherCompanies: ctx.otherCompanies } : {};
  const clean = (s: string): string => stripContacts(s, scanContacts(s, sc));
  const images = src.images.map((i) => ({
    ref: i.ref,
    leakStatus: i.leakStatus,
    included: i.leakStatus !== "suspect",
  }));
  return {
    product: clean(src.product),
    quantity: src.quantity,
    body: clean(src.body),
    price: null,
    images,
    hasSuspectImages: images.some((i) => !i.included),
  };
}
