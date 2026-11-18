// CR-185 · cảnh báo vàng điều kiện đối tác: trên MỘT quy trình có bước «Gửi đối tác xác nhận» (thiếu gì · ai sửa) và một dòng ở đầu mục khi chưa có quy trình «Nhận HĐ».
import { useTranslation } from "react-i18next";
import type { PartnerWarn } from "../lib/partner-warn";

/** «Còn thiếu: MST… · Nhờ quản trị nền tảng» — dùng lại chữ của Quản trị (`contracts.partner.confirm.*`) để một khái niệm một tên. */
export function useWarnText() {
  const { t } = useTranslation();
  return (w: PartnerWarn): string =>
    t("contracts.flow.current.partnerWarn.send", {
      what: w.what.map((k) => t(`contracts.partner.confirm.short.${k}`)).join(", "),
      who: w.who.map((x) => t(`contracts.partner.confirm.who.${x}`)).join(", "),
    });
}

export function SendWarn({ warn, testId }: { warn: PartnerWarn; testId: string }) {
  const text = useWarnText()(warn);
  return (
    <p className="mb-3 text-body font-medium text-warning" role="status" data-testid={testId}>
      {`⚠ ${text}`}
    </p>
  );
}

export function ReceiveWarn() {
  const { t } = useTranslation();
  return (
    <p
      className="mb-3 text-body font-medium text-warning"
      role="status"
      data-testid="flow-receive-warn"
    >
      {`⚠ ${t("contracts.flow.current.partnerWarn.receive")}`}
    </p>
  );
}
