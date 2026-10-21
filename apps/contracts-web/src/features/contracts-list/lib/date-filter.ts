// Gap #10 · lọc ngày của danh sách HĐ (hạn chót / hiệu lực đến): trạng thái nằm trên URL (`?due=` `?dfield=` `?df=` `?dt=`) nên chia sẻ/tải lại
// giữ nguyên. Thuần: phân tích + dựng tham số; "hôm nay" do server quyết theo ngày lịch tenant (client chỉ gửi `due`).
import { CONTRACT_DATE_FIELDS, CONTRACT_DUE_PRESETS } from "@ai/contracts";

export type DateField = (typeof CONTRACT_DATE_FIELDS)[number];
export type DuePreset = (typeof CONTRACT_DUE_PRESETS)[number];

/** `due` = cửa sổ tương đối; thiếu `due` mà có `from`/`to` = khoảng tuỳ chọn; không có gì = không lọc. */
export type DateFilter = {
  field: DateField;
  due?: DuePreset;
  from?: string;
  to?: string;
};

export const DEFAULT_DATE_FIELD: DateField = "end_date";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (s: unknown): s is string =>
  typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Khoá URL ngắn. */
export type DateSearch = { dfield?: DateField; due?: DuePreset; df?: string; dt?: string };

/** `validateSearch` của route: giữ khoá hợp lệ, bỏ phần còn lại (URL sai không làm hỏng trang). */
export function parseDateSearch(raw: Record<string, unknown>): DateSearch {
  const out: DateSearch = {};
  const field = CONTRACT_DATE_FIELDS.find((f) => f === raw.dfield);
  if (field && field !== DEFAULT_DATE_FIELD) out.dfield = field;
  const due = CONTRACT_DUE_PRESETS.find((p) => p === String(raw.due));
  if (due) out.due = due;
  else {
    if (isIso(raw.df)) out.df = raw.df;
    if (isIso(raw.dt)) out.dt = raw.dt;
  }
  return out;
}

export const dateFilterOf = (s: DateSearch): DateFilter => ({
  field: s.dfield ?? DEFAULT_DATE_FIELD,
  ...(s.due ? { due: s.due } : {}),
  ...(s.df ? { from: s.df } : {}),
  ...(s.dt ? { to: s.dt } : {}),
});

export const isDateActive = (f: DateFilter): boolean => !!(f.due || f.from || f.to);

/** Bộ lọc → khoá URL (bỏ giá trị mặc định); `undefined` = xoá khoá khi merge vào search. */
export function toDateSearch(f: DateFilter): Record<keyof DateSearch, string | undefined> {
  return {
    dfield: f.field === DEFAULT_DATE_FIELD ? undefined : f.field,
    due: f.due,
    df: f.due ? undefined : f.from,
    dt: f.due ? undefined : f.to,
  };
}

/** Tham số API (`date_field` chỉ gửi khi có lọc). */
export function dateParams(f: DateFilter): [string, string][] {
  if (!isDateActive(f)) return [];
  const out: [string, string][] = [["date_field", f.field]];
  if (f.due) out.push(["due", f.due]);
  else {
    if (f.from) out.push(["date_from", f.from]);
    if (f.to) out.push(["date_to", f.to]);
  }
  return out;
}
