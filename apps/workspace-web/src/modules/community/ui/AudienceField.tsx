// CR-191 BR-191-7 · ô «Ai thấy bài»: Tất cả đối tác (mặc định) · Chỉ nội bộ · Nhà cung cấp · Khách hàng · Chọn công ty… ;
// dưới ô «n/N công ty đối tác thấy bài» (đối tác trong cộng đồng + công ty đã kết nối). Thay «Nhắc tên» + chọn khách cũ.

import type {
  ConnectedAudienceCompany,
  PartnerOrg,
  PostAudience,
  PostType,
} from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { useApp } from "../application/ctx";
import { audienceCounts, audienceError } from "../domain/audience";
import { t } from "../i18n";
import { CompanyPicker } from "./CompanyPicker";

const CHOICES = ["all", "internal", "suppliers", "buyers", "companies"] as const;

export const ALL_AUDIENCE: PostAudience = { mode: "all", cats: [], companies: [], tenants: [] };

const toggle = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export function AudienceField({
  value,
  type,
  cats,
  onChange,
}: {
  value: PostAudience;
  type: PostType;
  cats: string[];
  onChange: (a: PostAudience) => void;
}) {
  const { api } = useApp();
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const [connected, setConnected] = useState<ConnectedAudienceCompany[]>([]);
  const tenantKey = value.tenants.join(",");
  useEffect(() => {
    api.listPartners({ limit: 50, offset: 0 }).then(setPartners, () => undefined);
  }, [api]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tenantKey` = danh sách đã tuần tự hoá
  useEffect(() => {
    api.audienceConnected(value.mode, value.tenants).then(setConnected, () => setConnected([]));
  }, [api, value.mode, tenantKey]);
  const { n, N } = audienceCounts(value, { type, cats }, partners, connected);
  const err = audienceError(value);
  return (
    <div className="audbox" data-testid="audience-field">
      <label className="flabel" htmlFor="aud-select">
        {t("community.audience.field")}
      </label>
      <OptionSelect
        id="aud-select"
        aria-label={t("community.audience.field")}
        data-testid="audience-select"
        value={value.mode}
        onValueChange={(m) =>
          onChange({ ...value, mode: m as PostAudience["mode"], tenants: [], companies: [] })
        }
      >
        {CHOICES.map((m) => (
          <option key={m} value={m}>
            {t(`community.audience.${m}`)}
          </option>
        ))}
      </OptionSelect>
      {value.mode === "companies" && (
        <div className="companypick" data-testid="audience-companies">
          {connected.length > 0 && (
            <>
              <div className="fhint">{t("community.audience.connectedTitle")}</div>
              <div className="chips">
                {connected.map((c) => (
                  <button
                    key={c.tenantId}
                    type="button"
                    className={value.tenants.includes(c.tenantId) ? "chip on" : "chip"}
                    aria-pressed={value.tenants.includes(c.tenantId)}
                    onClick={() =>
                      onChange({ ...value, tenants: toggle(value.tenants, c.tenantId) })
                    }
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <CompanyPicker
            selected={value.companies}
            onToggle={(id) => onChange({ ...value, companies: toggle(value.companies, id) })}
          />
        </div>
      )}
      <div className="audprev" data-testid="audience-preview" role="status">
        {err ?? t("community.audience.count", { n, N })}
      </div>
    </div>
  );
}
