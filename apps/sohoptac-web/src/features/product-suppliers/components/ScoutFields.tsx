// price-scout · ô nhập "Cấu hình dò giá" dùng chung (tab NCC & giá của SP + Cài đặt › Dò giá thị trường). Chỉ trình bày: nhận form chuỗi,
// báo thay đổi lên trên; `inherited` (tuỳ chọn) ⇒ hiện nhãn "theo mặc định nhóm" cạnh ô đang trùng mặc định.
import type { PriceScoutConfig } from "@ai/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LIST_MAX, type ScoutForm } from "../lib/scout";

const FIELD =
  "w-full rounded-lg border border-field bg-panel px-3 py-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-act disabled:opacity-60";

type Props = {
  /** Tiền tố id/test id (mỗi form một tiền tố khi nhiều form cùng trang). */
  idp: string;
  form: ScoutForm;
  set: (f: ScoutForm) => void;
  disabled: boolean;
  inherited?: ReadonlySet<keyof PriceScoutConfig>;
};

const TEXT = ["spec", "unit", "region"] as const;
const LISTS = ["keywords", "include_sites", "exclude_sites", "watched_suppliers"] as const;

function Row({
  id,
  k,
  label,
  inherited,
  children,
}: {
  id: string;
  k: keyof PriceScoutConfig;
  label: string;
  inherited?: ReadonlySet<keyof PriceScoutConfig>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-label text-ink-2">
        {label}
        {inherited?.has(k) && (
          <span data-testid={`${id}-inherited`} className="tag text-[11px] font-normal">
            {t("contracts.scout.inherited")}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

export function ScoutFields({ idp, form, set, disabled, inherited }: Props) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.scout.${k}`, o);
  const up = <K extends keyof ScoutForm>(k: K, v: ScoutForm[K]) => set({ ...form, [k]: v });
  const id = (k: string) => `${idp}-${k}`;
  return (
    <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      <label className="col-span-2 flex items-center gap-2 text-label max-md:col-span-1">
        <input
          type="checkbox"
          data-testid={id("enabled")}
          checked={form.enabled}
          disabled={disabled}
          onChange={(e) => up("enabled", e.target.checked)}
        />
        {L("f.enabled")}
        {inherited?.has("enabled") && <span className="tag text-[11px]">{L("inherited")}</span>}
      </label>
      {LISTS.map((k) => (
        <Row key={k} id={id(k)} k={k} label={L(`f.${k}`)} inherited={inherited}>
          <textarea
            id={id(k)}
            data-testid={id(k)}
            rows={2}
            className={FIELD}
            value={form[k]}
            disabled={disabled}
            placeholder={L(`ph.${k}`, { max: LIST_MAX })}
            onChange={(e) => up(k, e.target.value)}
          />
        </Row>
      ))}
      {TEXT.map((k) => (
        <Row key={k} id={id(k)} k={k} label={L(`f.${k}`)} inherited={inherited}>
          <input
            id={id(k)}
            data-testid={id(k)}
            className={FIELD}
            value={form[k]}
            disabled={disabled}
            onChange={(e) => up(k, e.target.value)}
          />
        </Row>
      ))}
      <Row id={id("vat")} k="vat" label={L("f.vat")} inherited={inherited}>
        <select
          id={id("vat")}
          data-testid={id("vat")}
          className={FIELD}
          value={form.vat}
          disabled={disabled}
          onChange={(e) => up("vat", e.target.value as ScoutForm["vat"])}
        >
          <option value="excl">{L("vat.excl")}</option>
          <option value="incl">{L("vat.incl")}</option>
        </select>
      </Row>
      <Row id={id("schedule")} k="schedule" label={L("f.schedule")} inherited={inherited}>
        <select
          id={id("schedule")}
          data-testid={id("schedule")}
          className={FIELD}
          value={form.schedule}
          disabled={disabled}
          onChange={(e) => up("schedule", e.target.value as ScoutForm["schedule"])}
        >
          <option value="off">{L("schedule.off")}</option>
          <option value="weekly">{L("schedule.weekly")}</option>
          <option value="monthly">{L("schedule.monthly")}</option>
        </select>
      </Row>
      <Row id={id("alert_pct")} k="alert_pct" label={L("f.alert_pct")} inherited={inherited}>
        <input
          id={id("alert_pct")}
          data-testid={id("alert_pct")}
          inputMode="numeric"
          className={FIELD}
          value={form.alert_pct}
          disabled={disabled}
          placeholder={L("ph.alert_pct")}
          onChange={(e) => up("alert_pct", e.target.value)}
        />
      </Row>
      <label className="flex items-center gap-2 text-label">
        <input
          type="checkbox"
          data-testid={id("alert_watched")}
          checked={form.alert_watched}
          disabled={disabled}
          onChange={(e) => up("alert_watched", e.target.checked)}
        />
        {L("f.alert_watched")}
        {inherited?.has("alert_watched") && (
          <span className="tag text-[11px]">{L("inherited")}</span>
        )}
      </label>
    </div>
  );
}
