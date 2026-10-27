// CR-101 DOC-legal (Câu 8) · MS-impact phụ: cảnh báo "Pháp lý" của giao dịch đứng riêng giá trị lớn còn mốc thu/trả mở. CHỈ cảnh báo
// (không chặn lưu/xác nhận), luôn kèm dòng "cần kế toán xác nhận". Dữ liệu `legal_warning` của chi tiết (null/vắng ⇒ không hiện).
import type { ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";

export function LegalBanner({ warning }: { warning: ContractDetail["legal_warning"] }) {
  const { t } = useTranslation();
  if (!warning) return null;
  return (
    <div
      role="note"
      data-testid="legal-warning"
      className="mb-3 rounded-xl border border-soon-line bg-soon-bg px-4 py-3 text-sm text-soon"
    >
      <b>{t("contracts.legal.title")}</b> — {t("contracts.legal.reason")}{" "}
      <span className="tnum">(≥ {vnd(warning.threshold)} đ)</span>
      <div className="mt-1 text-[12.5px]">{t("contracts.legal.accountantNote")}</div>
    </div>
  );
}
