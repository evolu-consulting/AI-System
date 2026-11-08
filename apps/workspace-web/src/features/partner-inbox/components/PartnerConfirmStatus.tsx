// CR-125 · UX-S7 (H7) · Cài đặt › «Đối tác xác nhận hợp đồng»: công ty thấy trạng thái THẬT (đang bật hay tắt), điều kiện nào còn thiếu và AI phải làm
// (nền tảng hay quản trị công ty). Chỉ xem: quyền cấp tính năng là của quản trị nền tảng. Cùng luật `partnerChecklist` với màn Quản trị nền tảng.
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "~/shared/ui/settings-layout";
import { usePartnerConfirmStatus } from "../hooks/use-partner-queries";

export function PartnerConfirmStatus({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const c = usePartnerConfirmStatus(owner);
  if (!c) return null;
  const todo = c.items.filter((i) => i.state !== "ok").length;
  const summary = !c.on
    ? t("contracts.partner.confirm.off")
    : c.ready_to_receive && c.ready_to_send
      ? t("contracts.partner.confirm.ready")
      : t("contracts.partner.confirm.missing", { count: todo });
  return (
    <SettingsGroup title={t("contracts.partner.confirm.title")}>
      <div data-testid="partner-confirm-status" data-on={c.on ? "yes" : "no"}>
        <p className="mb-2 text-body font-medium" data-testid="partner-confirm-summary">
          {summary}
        </p>
        <ul className="m-0 list-none space-y-1 p-0">
          {c.items.map((i) => (
            <li
              key={i.key}
              className="flex flex-wrap items-center gap-x-2 text-body"
              data-testid={`partner-confirm-item-${i.key}`}
              data-state={i.state}
            >
              <span className={i.state === "ok" ? "text-dim" : "font-medium text-late"}>
                {t(`contracts.partner.confirm.state.${i.state}`)}
              </span>
              <span>{t(`contracts.partner.confirm.item.${i.key}.${i.state}`)}</span>
              {i.state !== "ok" ? (
                <span className="text-dim">{`· ${t(`contracts.partner.confirm.who.${i.who}`)}`}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </SettingsGroup>
  );
}
