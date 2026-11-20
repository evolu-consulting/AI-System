// CR-191 BR-191-7 · ô «Ai thấy bài»: Tất cả đối tác (mặc định) · Chỉ nội bộ · Nhà cung cấp · Khách hàng · Chọn công ty… ;
// dưới ô «n/N công ty đối tác thấy bài» (đối tác trong cộng đồng + công ty đã kết nối). Thay «Nhắc tên» + chọn khách cũ.

import type {
  ConnectedAudienceCompany,
  PartnerOrg,
  PostAudience,
  PostType,
} from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useEffect, useState } from "react";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { useApp } from "../application/ctx";
import { audienceCounts, audienceError } from "../domain/audience";
import { t } from "../i18n";
import { CompanyPickDialog } from "./CompanyPickDialog";

const CHOICES = ["all", "internal", "suppliers", "buyers", "companies"] as const;

export const ALL_AUDIENCE: PostAudience = { mode: "all", cats: [], companies: [], tenants: [] };

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
  const [pick, setPick] = useState(false);
  const names = [
    ...connected.filter((c) => value.tenants.includes(c.tenantId)).map((c) => c.name),
    ...partners.filter((p) => value.companies.includes(p.id)).map((p) => p.name),
  ];
  const total = value.tenants.length + value.companies.length;
  const summary =
    total === 0
      ? t("community.audience.sumNone")
      : t("community.audience.sumSome", {
          n: total,
          names: names.slice(0, 2).join(", ") + (total > 2 ? "…" : ""),
        });
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
        onValueChange={(m) => {
          onChange({ ...value, mode: m as PostAudience["mode"], tenants: [], companies: [] });
          if (m === "companies") setPick(true);
        }}
      >
        {CHOICES.map((m) => (
          <option key={m} value={m}>
            {t(`community.audience.${m}`)}
          </option>
        ))}
      </OptionSelect>
      {value.mode === "companies" && (
        <div className="audsum" data-testid="audience-companies-summary">
          <span>{summary}</span>
          <Button
            variant="quiet"
            size="sm"
            data-testid="audience-edit"
            onClick={() => setPick(true)}
          >
            {t("community.audience.edit")}
          </Button>
        </div>
      )}
      <CompanyPickDialog
        open={pick}
        onOpenChange={setPick}
        value={value}
        connected={connected}
        onChange={onChange}
      />
      <div className="audprev" data-testid="audience-preview" role="status">
        {err ?? t("community.audience.count", { n, N })}
      </div>
    </div>
  );
}
