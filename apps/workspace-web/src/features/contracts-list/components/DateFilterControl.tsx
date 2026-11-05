// Gap #10 · lọc ngày trong thanh công cụ: cột (hiệu lực đến | hạn chót) + cửa sổ (quá hạn, 30/60/90 ngày, khoảng tuỳ chọn). Trạng thái do
// trang giữ trên URL; component chỉ hiển thị và gọi `onChange`.
import { CONTRACT_DUE_PRESETS } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DateField,
  type DateFilter,
  DEFAULT_DATE_FIELD,
  type DuePreset,
} from "../lib/date-filter";

type Mode = "" | DuePreset | "range";
const modeOf = (f: DateFilter): Mode => f.due ?? (f.from || f.to ? "range" : "");
const FIELDS: DateField[] = ["end_date", "action_deadline"];

const SELECT =
  "h-9 rounded-full border border-field bg-panel px-3 text-[13.5px] text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

export function DateFilterControl({
  value,
  onChange,
}: {
  value: DateFilter;
  onChange: (f: DateFilter) => void;
}) {
  const { t } = useTranslation();
  // "Khoảng tuỳ chọn" chưa có ngày nào không biểu diễn được trên URL ⇒ giữ cờ mở ở state cục bộ, nếu không ô Từ/Đến ngày không bao giờ hiện.
  const [rangeOpen, setRangeOpen] = useState(false);
  const urlMode = modeOf(value);
  const mode: Mode = urlMode === "" && rangeOpen ? "range" : urlMode;
  const setMode = (m: Mode) => {
    setRangeOpen(m === "range");
    if (m === "") return onChange({ field: value.field });
    if (m === "range")
      return onChange({ field: value.field, from: value.from ?? "", to: value.to ?? "" });
    onChange({ field: value.field, due: m });
  };
  const clean = (f: DateFilter): DateFilter => ({
    field: f.field,
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  });
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">{t("contracts.list.date.label")}</legend>
      <select
        aria-label={t("contracts.list.date.field")}
        className={SELECT}
        value={value.field ?? DEFAULT_DATE_FIELD}
        onChange={(e) => onChange({ ...value, field: e.target.value as DateField })}
      >
        {FIELDS.map((k) => (
          <option key={k} value={k}>
            {t(`contracts.list.date.fields.${k}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t("contracts.list.date.window")}
        className={SELECT}
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
      >
        <option value="">{t("contracts.list.date.any")}</option>
        {CONTRACT_DUE_PRESETS.map((p) => (
          <option key={p} value={p}>
            {t(`contracts.list.date.due.${p}`)}
          </option>
        ))}
        <option value="range">{t("contracts.list.date.range")}</option>
      </select>
      {mode === "range" && (
        <>
          <input
            type="date"
            aria-label={t("contracts.list.date.from")}
            className={SELECT}
            value={value.from ?? ""}
            max={value.to || undefined}
            onChange={(e) => onChange(clean({ ...value, from: e.target.value }))}
          />
          <span className="text-dim">–</span>
          <input
            type="date"
            aria-label={t("contracts.list.date.to")}
            className={SELECT}
            value={value.to ?? ""}
            min={value.from || undefined}
            onChange={(e) => onChange(clean({ ...value, to: e.target.value }))}
          />
        </>
      )}
    </fieldset>
  );
}
