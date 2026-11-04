// DOC-ui-gaps · Câu 8: cảnh báo pháp lý TRƯỚC khi lưu giao dịch — cùng luật `legalWarning` của máy chủ (hub-api `legal-warn.rules.ts`):
// giao dịch đứng riêng (không thuộc HĐ NT), tổng giá trị ≥ ngưỡng `legal_warn_threshold` (GET /company), còn mốc thu/trả chưa xong.
// Mốc mặc định của giao dịch mới còn mở trừ khi tích "đã giao / đã thanh toán ngay". Chỉ cảnh báo, không chặn. Ngưỡng 0 = tắt.
// Giới thiệu: giá trị = hoa hồng cố định (hoa hồng % chưa có cơ sở trong form ⇒ không cảnh báo, như máy chủ khi value null).
import type { ContractDeal } from "@ai/contracts";

export type LegalPreInput = {
  threshold: number | undefined;
  deal: ContractDeal;
  /** Giá trị giao dịch (mua/bán; đã tự cộng dòng hàng nếu để trống) hoặc hoa hồng cố định (giới thiệu). */
  total: number | null;
  frameId: string | null;
  settledNow: boolean;
};

export function showLegalWarning(i: LegalPreInput): boolean {
  if (i.threshold === undefined || i.threshold <= 0) return false;
  if (i.frameId !== null || i.settledNow || i.total === null) return false;
  return i.total >= i.threshold;
}

/** Tổng dùng cho cảnh báo từ số đã đọc của form. */
export function legalTotal(
  deal: ContractDeal,
  n: { total_value: number | null; commission_fixed: number | null },
  auto: number | null,
): number | null {
  return deal === "referral" ? n.commission_fixed : (n.total_value ?? auto);
}
