// CR-101 DOC-legal · Câu 8: luật thuần cảnh báo pháp lý. Giao dịch ĐỨNG RIÊNG (doc_type = deal, không thuộc HĐ NT) có tổng giá trị ≥ ngưỡng
// mà còn mốc thu/trả chưa xong ⇒ cảnh báo (chỉ cảnh báo, không chặn; luôn kèm "cần kế toán xác nhận"). Ngưỡng 0 = tắt. Lớp 1 — không I/O.
// Điều kiện SQL của nguồn Cần xử lý `legal` (todo.repo.ts) PHẢI khớp `legalWarning` — sửa cả hai.
import { moneyBase } from "./milestones.rules";

export const LEGAL_WARN_DEFAULT = 5_000_000;
export const LEGAL_REASON =
  "Giao dịch đứng riêng giá trị lớn, còn mốc thu/trả chưa xong — cần kế toán xác nhận";

export type LegalWarning = { threshold: number; reason: string };
export type LegalInput = {
  doc_type: string;
  frame_root_id: string | null;
  deal: "buy" | "sell" | "referral" | null;
  value: number | null;
  commission_pct: number | string | null;
  commission_fixed: number | null;
  /** Mốc tiền (thu/trả/hoa hồng) còn mở (chưa xong, chưa huỷ). */
  open_money_milestones: number;
  threshold: number;
};

export function legalWarning(i: LegalInput): LegalWarning | null {
  if (i.threshold <= 0 || i.doc_type !== "deal" || i.frame_root_id !== null) return null;
  if (i.open_money_milestones <= 0 || i.deal === null) return null;
  const total = moneyBase({
    deal: i.deal,
    value: i.value,
    pct: i.commission_pct,
    fixed: i.commission_fixed,
  });
  if (total === null || total < i.threshold) return null;
  return { threshold: i.threshold, reason: LEGAL_REASON };
}
