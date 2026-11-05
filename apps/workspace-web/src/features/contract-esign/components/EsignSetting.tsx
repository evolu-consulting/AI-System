// cf-esign-docusign · ô "Ký số hợp đồng" trong Cài đặt › Quy trình duyệt: owner bật/tắt + chọn nhà cung cấp mặc định
// (PUT /esign/settings); server chưa cấu hình ⇒ "Chưa cấu hình ký số", ô khoá; ký thử ⇒ nhãn không có giá trị pháp lý.
import type { ESignProviderOut } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
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

export function EsignSetting({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const { q, m } = useEsignSettings((e) =>
    toast(t(esignErrKey(e instanceof ApiError ? e.code : null)), "late"),
  );
  const s = q.data;
  if (!s) return null;
  const providers = s.providers ?? [];
  return (
    <div data-testid="esign-setting" className="mt-6 border-t border-rule pt-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={s.enabled}
          disabled={!owner || !s.configured || m.isPending}
          onChange={(e) => m.mutate({ enabled: e.target.checked })}
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
      {providers.length > 0 && (
        <ProviderSelect
          providers={providers}
          value={s.default_provider ?? ""}
          disabled={!owner || !s.configured || m.isPending}
          onChange={(key) => m.mutate({ default_provider: key })}
        />
      )}
      {s.configured && <EsignAnchorSetting owner={owner} />}
    </div>
  );
}
