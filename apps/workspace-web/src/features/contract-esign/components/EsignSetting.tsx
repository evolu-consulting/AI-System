// cf-esign-docusign · ô "Ký số hợp đồng" trong Cài đặt › Quy trình duyệt: owner bật/tắt + chọn nhà cung cấp mặc định
// (PUT /esign/settings); server chưa cấu hình ⇒ "Chưa cấu hình ký số", ô khoá; ký thử ⇒ nhãn không có giá trị pháp lý.
import type { ESignProviderOut } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/lib/api-error";
import { useEsignSettings } from "../hooks/use-esign-settings";
import { esignErrKey } from "../lib/esign-view";
import { EsignAnchorSetting } from "./EsignAnchorSetting";

function ProviderSelect({
  providers,
  value,
  disabled,
  onChange,
}: {
  providers: ESignProviderOut[];
  value: string;
  disabled: boolean;
  onChange: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex flex-col gap-1 text-[13px]" data-testid="esign-provider-setting">
      <label className="flex items-center gap-3">
        <span className="font-semibold">{t("contracts.esign.defaultProvider")}</span>
        <select
          className="field"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {providers.map((p) => (
            <option key={p.key} value={p.key} disabled={!p.available}>
              {p.label}
              {p.available ? "" : ` (${t("contracts.esign.providerUnavailable")})`}
            </option>
          ))}
        </select>
      </label>
      <ul className="text-caption text-dim">
        {providers.map((p) => (
          <li
            key={p.key}
            className={p.available ? "" : "opacity-50"}
            data-testid={`esign-prov-${p.key}`}
          >
            {p.label} · {t(p.legal ? "contracts.esign.legal" : "contracts.esign.notLegal")}
            {p.available ? "" : ` · ${t("contracts.esign.providerUnavailable")}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** CR-125 · S2 · trạng thái ký số khi người xem KHÔNG đổi được (không phải chủ gói / chưa cấu hình ký số): nói rõ trạng thái + lý do + ai làm, không có ô khoá. */
function EsignStatus({ enabled, reason }: { enabled: boolean; reason: string }) {
  const { t } = useTranslation();
  return (
    <div data-testid="esign-setting" className="mt-6 border-t border-rule pt-4">
      <p className="flex items-center gap-3">
        <span className="font-semibold">{t("contracts.esign.settingLabel")}</span>
        <span className="text-caption text-dim" data-testid="esign-status">
          {enabled ? t("contracts.esign.settingOn") : t("contracts.esign.settingOff")}
        </span>
      </p>
      <p className="mt-1 text-caption text-dim" data-testid="esign-status-reason">
        {reason}
      </p>
    </div>
  );
}

export function EsignSetting({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const { q, m } = useEsignSettings((e) =>
    toast(t(esignErrKey(e instanceof ApiError ? e.code : null)), "late"),
  );
  const s = q.data;
  if (!s) return null;
  if (!s.configured)
    return <EsignStatus enabled={s.enabled} reason={t("contracts.esign.notConfigured")} />;
  if (!owner)
    return <EsignStatus enabled={s.enabled} reason={t("contracts.esign.settingOwnerOnly")} />;
  const providers = s.providers ?? [];
  const save = (patch: Parameters<typeof m.mutate>[0]) =>
    m.mutate(patch, { onSuccess: () => toast(t("contracts.esign.settingSaved")) });
  return (
    <div data-testid="esign-setting" className="mt-6 border-t border-rule pt-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          data-testid="esign-enabled"
          checked={s.enabled}
          disabled={m.isPending}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        <span className="font-semibold">{t("contracts.esign.settingLabel")}</span>
        <span className="text-caption text-dim">
          {s.enabled ? t("contracts.esign.settingOn") : t("contracts.esign.settingOff")}
        </span>
      </label>
      <p className="mt-1 text-caption text-dim">
        {t("contracts.esign.settingHint")}
        {s.demo ? ` · ${t("contracts.esign.demo")}` : ""}
      </p>
      {providers.length > 0 && (
        <ProviderSelect
          providers={providers}
          value={s.default_provider ?? ""}
          disabled={m.isPending}
          onChange={(key) => save({ default_provider: key })}
        />
      )}
      <div className="mt-3 text-[13px]" data-testid="esign-invite-thumb-setting">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={s.invite_thumbnail}
            disabled={m.isPending}
            onChange={(e) => save({ invite_thumbnail: e.target.checked })}
          />
          <span className="font-semibold">{t("contracts.esign.inviteThumb")}</span>
        </label>
        <p className="mt-1 text-caption text-dim">{t("contracts.esign.inviteThumbHint")}</p>
      </div>
      <EsignAnchorSetting owner={owner} />
    </div>
  );
}
