// ADM-FR-51, ADM-FR-52 · M4-R12 · khoảng thời gian cho PeriodFilter (hàm thuần).
export const PERIOD_PRESETS = [7, 30, 90] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type Period =
  | { kind: "preset"; days: PeriodPreset }
  | { kind: "custom"; from: string; to: string };

export type DateRange = { from: string; to: string };

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD` theo giờ địa phương. */
export const toDateOnly = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Preset N ngày = N ngày gồm hôm nay (`to` = hôm nay). Tuỳ chọn trả nguyên. */
export function periodRange(period: Period, today: Date): DateRange {
  if (period.kind === "custom") return { from: period.from, to: period.to };
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (period.days - 1),
  );
  return { from: toDateOnly(start), to: toDateOnly(today) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hợp lệ khi cả hai ngày có dạng YYYY-MM-DD và `from` ≤ `to`. */
export function isValidCustom(from: string, to: string): boolean {
  return DATE_RE.test(from) && DATE_RE.test(to) && from <= to;
}
