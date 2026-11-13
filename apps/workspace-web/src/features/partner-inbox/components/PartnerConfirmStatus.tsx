// CR-125 · UX-S7 (H7) · Cài đặt › «Đối tác xác nhận hợp đồng»: công ty thấy trạng thái THẬT (đang bật hay tắt), điều kiện nào còn thiếu và AI phải làm
// (nền tảng hay quản trị công ty). Chỉ xem: quyền cấp tính năng là của quản trị nền tảng. Cùng luật `partnerChecklist` với màn Quản trị nền tảng.
import { openInNewTab } from "@ai/web-kit/auth/open-tab";
import { toast } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
import { flowEditorUrl } from "~/features/settings/lib/editor-link";
import { SettingsGroup } from "~/shared/ui/settings-layout";
import { usePartnerConfirmStatus } from "../hooks/use-partner-queries";

/** CR-138b · thiếu quy trình Nhận/Gửi ⇒ nút mở trang Quy trình (cùng đường `flowEditorUrl` với Cài đặt › Quy trình duyệt). */
function OpenFlowsButton() {
  const { t } = useTranslation();
  const go = async () => {
    const ok = await openInNewTab(() => flowEditorUrl());
    if (!ok) toast(t("contracts.flow.current.openFail"), "late");
  };
  return (
    <button
      type="button"
      data-testid="partner-open-flows"
      className="btn btn-sm btn-outline"
      onClick={() => void go()}
    >
      {t("contracts.flow.current.openPage")}
    </button>
  );
}

export function PartnerConfirmStatus({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const c = usePartnerConfirmStatus(owner);
  if (!c) return null;
  const todo = c.items.filter((i) => i.state !== "ok");
  // CR-143: một dòng tóm: bật/tắt · còn thiếu gì · ai làm.
  const who = [...new Set(todo.map((i) => t(`contracts.partner.confirm.who.${i.who}`)))].join(", ");
  const what = todo.map((i) => t(`contracts.partner.confirm.short.${i.key}`)).join(", ");
  const summary = !c.on
    ? t("contracts.partner.confirm.off")
    : c.ready_to_receive && c.ready_to_send
      ? t("contracts.partner.confirm.ready")
      : t("contracts.partner.confirm.missing", { what, who });
  return (
    <SettingsGroup title={t("contracts.partner.confirm.title")}>
      <div data-testid="partner-confirm-status" data-on={c.on ? "yes" : "no"}>
        <p className="mb-2 text-body font-medium" data-testid="partner-confirm-summary">
          {summary}
        </p>
        <ul className="m-0 list-none space-y-1 p-0">
          {todo.map((i) => (
            <li
              key={i.key}
              className="flex flex-wrap items-center gap-x-2 text-body"
              data-testid={`partner-confirm-item-${i.key}`}
              data-state={i.state}
            >
              <span className="font-medium text-late">
                {t(`contracts.partner.confirm.state.${i.state}`)}
              </span>
              <span>{t(`contracts.partner.confirm.item.${i.key}.${i.state}`)}</span>
              <span className="text-dim">{`· ${t(`contracts.partner.confirm.who.${i.who}`)}`}</span>
              {i.fix === "open-flows" ? <OpenFlowsButton /> : null}
            </li>
          ))}
        </ul>
      </div>
    </SettingsGroup>
  );
}
