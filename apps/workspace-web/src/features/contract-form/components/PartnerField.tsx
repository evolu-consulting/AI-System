// V2-F · HD-10 · BA 5.6: ô đối tác (nhãn theo loại HĐ) + trạng thái gợi ý từ `GET /partners/lookup` (V2-C): điểm uy tín theo vai,
// "Đã có · thêm vai trò …", "Mới", hoặc "Đối tác mới · sẽ tạo khi lưu". Gõ ≥ 2 ký tự mới tra (debounce, không tra từng phím).
import type { ContractDeal, PartnerLookup } from "@ai/contracts/pack-contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import { usePartnerLookup } from "../hooks/use-partner-lookup";
import { usePartnerOptions, usePartnerSuggest } from "../hooks/use-partner-pick";
import { PARTNER_ROLE } from "../lib/deal";
import type { PartnerSearchHit } from "../lib/partner-match";

const BAND_CLS = {
  good: "bg-ok-bg text-ok",
  fair: "bg-act-soft text-act",
  watch: "bg-soon-bg text-soon",
} as const;

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
  picked,
  onPick,
  invalid,
  disabled,
  unsure,
  suggest,
}: {
  deal: ContractDeal;
  name: string;
  taxId: string;
  onName: (v: string) => void;
  /** CR-122 p10: đối tác đã chọn từ sổ (MST/CCCD lấy từ sổ, ô chỉ đọc); null = tên gõ tay. */
  picked: PartnerSearchHit | null;
  onPick: (hit: PartnerSearchHit | null) => void;
  invalid: boolean;
  disabled?: boolean;
  /** V2-G: AI chưa chắc tên đối tác ⇒ tô vàng. */
  unsure?: boolean;
  /** Tên/MST đang có là do AI đọc ra ⇒ tự gợi ý khớp với sổ (một lần). */
  suggest?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { q, look } = usePartnerLookup(name, taxId, deal);
  const opts = usePartnerOptions(name, deal, open && !picked);
  const [init] = useState({ name, taxId });
  const sug = usePartnerSuggest(init, deal, !!suggest && !disabled && !picked);
  const auto = useRef(false);
  const s = sug.data;
  useEffect(() => {
    if (s?.kind === "sure" && !auto.current) {
      auto.current = true;
      onPick(s.hit);
    }
  }, [s, onPick]);
  const label = t(`contracts.cform.partnerRole.${PARTNER_ROLE[deal]}`);
  const hits = opts.data ?? [];
  return (
    <div className="relative flex flex-col gap-1 text-[13px]">
      <label htmlFor="cf-partner">
        {label} <span className="text-late">*</span>
        {unsure && <Tag tone="soon">{t("contracts.cform.unsure")}</Tag>}
      </label>
      <input
        id="cf-partner"
        name="partner_name"
        data-testid="partner-input"
        autoComplete="off"
        value={name}
        disabled={disabled}
        onChange={(e) => {
          if (picked) onPick(null);
          onName(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
      {open && !picked && !disabled && hits.length > 0 && (
        <ul
          data-testid="partner-options"
          className="absolute top-full z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface shadow-md"
        >
          {hits.map((h) => (
            <li key={h.party}>
              <button
                type="button"
                data-testid="partner-option"
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-act-soft"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(h);
                  setOpen(false);
                }}
              >
                <span>{h.name ?? h.party}</span>
                <span className="font-mono text-[12px] text-dim">{h.tax_id ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="flex min-h-5 flex-wrap items-center gap-1.5">
        {picked && (
          <Tag tone="act" className="max-w-full">
            {t("contracts.cform.partnerAutoPicked")}
          </Tag>
        )}
        {!picked && s?.kind === "maybe" && (
          <span className="flex flex-wrap items-center gap-1.5" data-testid="partner-maybe">
            {s.hits.map((h) => (
              <button
                key={h.party}
                type="button"
                data-testid="partner-maybe-option"
                className="rounded-md bg-soon-bg px-2 py-0.5 text-[12px] text-soon"
                onClick={() => onPick(h)}
              >
                {t("contracts.cform.partnerMaybe", { name: h.name ?? h.party })}
              </button>
            ))}
          </span>
        )}
        {!picked && q.length >= 2 && <PartnerStatus look={look.data} deal={deal} />}
      </span>
    </div>
  );
}
