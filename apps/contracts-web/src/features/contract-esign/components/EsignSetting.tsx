// cf-esign-docusign · ô "Ký số hợp đồng" trong Cài đặt › Quy trình duyệt: owner bật/tắt (PUT /esign/settings); server chưa cấu hình
// nhà cung cấp ⇒ hiện "Chưa cấu hình ký số", ô khoá; ký thử ⇒ nhãn không có giá trị pháp lý.
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { useEsignSettings } from "../hooks/use-esign-settings";

export function EsignSetting({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const { q, m } = useEsignSettings(() => toast(t("contracts.esign.err.unknown"), "late"));
  const s = q.data;
  if (!s) return null;
  return (
    <div data-testid="esign-setting" className="mt-6 border-t border-rule pt-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={s.enabled}
          disabled={!owner || !s.configured || m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span className="font-semibold">{t("contracts.esign.settingLabel")}</span>
        <span className="text-caption text-dim">
          {s.enabled ? t("contracts.esign.settingOn") : t("contracts.esign.settingOff")}
        </span>
      </label>
      <p className="mt-1 text-caption text-dim">
        {s.configured ? t("contracts.esign.settingHint") : t("contracts.esign.notConfigured")}
        {s.demo ? ` · ${t("contracts.esign.demo")}` : ""}
      </p>
    </div>
  );
}
