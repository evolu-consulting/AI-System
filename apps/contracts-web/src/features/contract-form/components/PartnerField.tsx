// V2-F · HD-10 · BA 5.6: ô đối tác (nhãn theo loại HĐ) + trạng thái gợi ý từ `GET /partners/lookup` (V2-C): điểm uy tín theo vai,
// "Đã có · thêm vai trò …", "Mới", hoặc "Đối tác mới · sẽ tạo khi lưu". Gõ ≥ 2 ký tự mới tra (debounce, không tra từng phím).
import type { ContractDeal, PartnerLookup } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import { lookupKey, lookupPartner } from "../api";
import { PARTNER_ROLE } from "../lib/deal";

const DEBOUNCE_MS = 300;
const BAND_CLS = {
  good: "bg-ok-bg text-ok",
  fair: "bg-act-soft text-act",
  watch: "bg-soon-bg text-soon",
} as const;

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function PartnerStatus({
  look,
  deal,
}: {
  look: PartnerLookup | undefined;
  deal: ContractDeal;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cform.${k}`, o);
  const role = L(`partnerRole.${PARTNER_ROLE[deal]}`).toLowerCase();
  if (!look) return null;
  if (look.status === "new")
    return (
      <Tag tone="soon" className="max-w-full">
        {L("partnerNew")}
      </Tag>
    );
  if (!look.has_role)
    return (
      <span className="flex items-center gap-1.5 text-[12px]">
        <Tag tone="act">{L("partnerKnown")}</Tag>
        <span className="text-dim">{L("partnerAddRole", { role })}</span>
      </span>
    );
  if (look.score == null || !look.band)
    return (
      <span className="flex items-center gap-1.5 text-[12px]">
        <Tag tone="grey">{L("partnerFresh")}</Tag>
        <span className="text-dim">{L("partnerFreshHint", { role })}</span>
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[12px]" data-testid="partner-score">
      <span
        className={cn(
          "inline-flex h-[22px] items-center gap-1.5 rounded-md px-2",
          BAND_CLS[look.band],
        )}
      >
        <b className="tnum">{look.score}</b>
        {t(`contracts.partners.band.${look.band}`)}
      </span>
      <span className="text-dim">{L("partnerScoreOf", { role })}</span>
    </span>
  );
}

export function PartnerField({
  deal,
  name,
  taxId,
  onName,
  invalid,
  disabled,
  unsure,
}: {
  deal: ContractDeal;
  name: string;
  taxId: string;
  onName: (v: string) => void;
  invalid: boolean;
  disabled?: boolean;
  /** V2-G: AI chưa chắc tên đối tác ⇒ tô vàng. */
  unsure?: boolean;
}) {
  const { t } = useTranslation();
  const q = useDebounced(name.trim(), DEBOUNCE_MS);
  const look = useQuery({
    queryKey: lookupKey(q, taxId, deal),
    queryFn: ({ signal }) => lookupPartner(q, taxId, deal, signal),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
  const label = t(`contracts.cform.partnerRole.${PARTNER_ROLE[deal]}`);
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <label htmlFor="cf-partner">
        {label} <span className="text-late">*</span>
        {unsure && <Tag tone="soon">{t("contracts.cform.unsure")}</Tag>}
      </label>
      <input
        id="cf-partner"
        name="partner_name"
        value={name}
        disabled={disabled}
        onChange={(e) => onName(e.target.value)}
        placeholder={t("contracts.cform.partnerPlaceholder")}
        aria-invalid={invalid}
        data-unsure={unsure || undefined}
        style={
          unsure
            ? { background: "var(--color-soon-bg)", borderColor: "var(--color-soon-line)" }
            : undefined
        }
        className={cn("field", invalid && "border-late")}
      />
      <span className="flex min-h-5 items-center">
        {q.length >= 2 && <PartnerStatus look={look.data} deal={deal} />}
      </span>
    </div>
  );
}
