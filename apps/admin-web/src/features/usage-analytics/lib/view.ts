// ADM-FR-42 · usage-analytics · hàm thuần của màn Phân tích token: khoảng ngày theo preset (giờ VN), xoay chuỗi thời gian
// thành ma trận xô × app (biểu đồ cột chồng), màu theo app, % thay đổi, tỉ lệ lỗi. Không đọc i18n/DOM — test được.
import type { UsageAnalytics, UsageGrain } from "@ai/contracts";

export const PRESETS = ["7d", "30d", "90d", "month", "prevMonth"] as const;
export type Preset = (typeof PRESETS)[number];
export const isPreset = (v: unknown): v is Preset => PRESETS.includes(v as Preset);

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Khoảng [from, to] (`YYYY-MM-DD`, ngày VN) của preset tại `now`. */
export function presetRange(p: Preset, now: Date): { from: string; to: string } {
  const vn = now.getTime() + VN_OFFSET_MS;
  const today = day(vn);
  const d = new Date(vn);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (p) {
    case "7d":
      return { from: day(vn - 6 * DAY_MS), to: today };
    case "30d":
      return { from: day(vn - 29 * DAY_MS), to: today };
    case "90d":
      return { from: day(vn - 89 * DAY_MS), to: today };
    case "month":
      return { from: day(Date.UTC(y, m, 1)), to: today };
    case "prevMonth":
      return { from: day(Date.UTC(y, m - 1, 1)), to: day(Date.UTC(y, m, 1) - DAY_MS) };
  }
}

/** Xô mặc định theo độ dài khoảng: ≤ 45 ngày → ngày, ≤ 180 → tuần, còn lại → tháng. */
export function defaultGrain(from: string, to: string): UsageGrain {
  const n = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  return n <= 45 ? "day" : n <= 180 ? "week" : "month";
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRAINS: readonly string[] = ["day", "week", "month"];

/** Khoảng + xô từ URL: `from`+`to` hợp lệ ⇒ tuỳ chọn; không thì preset (mặc định 30 ngày); xô lạ ⇒ theo độ dài. */
export function rangeOf(
  s: { preset?: string; from?: string; to?: string; grain?: string },
  now: Date,
): { preset: Preset | "custom"; range: { from: string; to: string }; grain: UsageGrain } {
  const custom = !!s.from && !!s.to && DAY_RE.test(s.from) && DAY_RE.test(s.to);
  const preset = custom ? "custom" : isPreset(s.preset) ? s.preset : "30d";
  const range =
    preset === "custom" ? { from: s.from as string, to: s.to as string } : presetRange(preset, now);
  const grain = GRAINS.includes(s.grain ?? "")
    ? (s.grain as UsageGrain)
    : defaultGrain(range.from, range.to);
  return { preset, range, grain };
}

export type Stack = { buckets: string[]; apps: string[]; values: number[][]; max: number };

/** Chuỗi (xô, app, token) → ma trận `values[bucket][app]`; app xếp theo tổng giảm dần; `max` = cột cao nhất. */
export function stackOf(series: UsageAnalytics["series"]): Stack {
  const total = new Map<string, number>();
  for (const s of series) total.set(s.app, (total.get(s.app) ?? 0) + s.tokens);
  const apps = [...total].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a);
  const buckets = [...new Set(series.map((s) => s.bucket))].sort();
  const at = new Map(series.map((s) => [`${s.bucket}|${s.app}`, s.tokens]));
  const values = buckets.map((b) => apps.map((a) => at.get(`${b}|${a}`) ?? 0));
  const max = values.reduce(
    (m, row) =>
      Math.max(
        m,
        row.reduce((x, y) => x + y, 0),
      ),
    0,
  );
  return { buckets, apps, values, max };
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-5)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--muted-foreground)",
];
/** Màu cố định theo thứ hạng app trong biểu đồ (≥ 6 dùng màu cuối). */
export const colorAt = (i: number): string => PALETTE[Math.min(i, PALETTE.length - 1)] as string;

/** % thay đổi so với kỳ trước (làm tròn); kỳ trước 0 → null. */
export function deltaPct(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Tỉ lệ lỗi (%), 1 số lẻ; 0 lời gọi → 0. */
export const errorPct = (errors: number, calls: number): number =>
  calls === 0 ? 0 : Math.round((errors / calls) * 1000) / 10;

/** Phần trăm của `part` trong `total` (1 số lẻ). */
export const sharePct = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
