// ADM-FR-42 · M4-R01 · kỳ báo cáo = 12 tháng gần nhất (hàm thuần). Giá trị `YYYY-MM`; ngày theo giờ Việt Nam (UTC+7).
const VN_OFFSET_MS = 7 * 3_600_000;
const MONTHS = 12;
const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM` của `now` theo giờ VN. */
export function currentMonth(now: Date): string {
  const d = new Date(now.getTime() + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function shift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** 12 tháng gần nhất, tháng hiện tại đứng đầu. */
export function recentMonths(now: Date): string[] {
  const cur = currentMonth(now);
  return Array.from({ length: MONTHS }, (_, i) => shift(cur, -i));
}

export const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

/** Ngày đầu / cuối của tháng (`YYYY-MM-DD`). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export const previousMonth = (month: string): string => shift(month, -1);

/** `2026-09` → `09/2026`. */
export const monthLabel = (month: string): string => month.split("-").reverse().join("/");

/** % thay đổi so với kỳ trước; kỳ trước = 0 → `null` (không có mốc so sánh). */
export function deltaPct(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
