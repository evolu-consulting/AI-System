// GAP-D2 · #27 · BA v2 (mockup `spark` + "Cảnh báo bất thường"): đường xu hướng 6 tháng + luật cảnh báo bất thường của một đối tác.
// Thuần, tính trên dữ liệu đã có (lịch sử điểm + việc góp điểm): (1) điểm tụt mạnh so với tháng trước; (2) tỷ lệ trễ hạn tăng đột
// ngột trong 30 ngày gần nhất so với 90 ngày trước đó (chỉ tính mốc đối tác chịu lỗi hoặc chưa rõ lỗi; lỗi của mình không tính).
import type { RepDetailItem } from "@ai/contracts";
import type { ChartPoint } from "./partner-v2";

/** Điểm tụt từ tháng trước sang tháng này đạt ngưỡng này ⇒ cảnh báo. */
export const DROP_POINTS = 10;
/** Cửa sổ "gần đây" và "trước đó" (ngày) cho tỷ lệ trễ; cần tối thiểu từng này mốc mỗi cửa sổ. */
export const RECENT_DAYS = 30;
export const BASE_DAYS = 90;
export const MIN_RECENT = 3;
/** Tỷ lệ trễ gần đây phải ≥ mức này VÀ cao hơn nền ít nhất `LATE_JUMP` điểm phần trăm. */
export const LATE_FLOOR = 50;
export const LATE_JUMP = 30;

export type Alert =
  | { kind: "score_drop"; from: number; to: number; period: string }
  | { kind: "late_spike"; recent: number; base: number | null; n: number };

const DAY_MS = 86_400_000;
const day = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Mốc đã xong có tính cho "trễ": bỏ việc ghi tay và mốc trễ do mình. */
const counted = (i: RepDetailItem): boolean => i.source === "milestone" && i.fault !== "ours";
const isLate = (i: RepDetailItem): boolean => (i.late_days ?? 0) > 0;

function lateRate(items: readonly RepDetailItem[]): { pct: number; n: number } | null {
  if (!items.length) return null;
  return { pct: Math.round((items.filter(isLate).length / items.length) * 100), n: items.length };
}

export function alertsOf(
  series: readonly ChartPoint[],
  items: readonly RepDetailItem[],
  today: string,
): Alert[] {
  const out: Alert[] = [];
  const a = series[series.length - 2];
  const b = series[series.length - 1];
  if (a && b && a.score - b.score >= DROP_POINTS)
    out.push({ kind: "score_drop", from: a.score, to: b.score, period: b.period });

  const t = day(today);
  const ms = items.filter(counted);
  const recent = lateRate(ms.filter((i) => t - day(i.at) < RECENT_DAYS * DAY_MS && day(i.at) <= t));
  const base = lateRate(
    ms.filter(
      (i) =>
        t - day(i.at) >= RECENT_DAYS * DAY_MS && t - day(i.at) < (RECENT_DAYS + BASE_DAYS) * DAY_MS,
    ),
  );
  if (
    recent &&
    recent.n >= MIN_RECENT &&
    recent.pct >= LATE_FLOOR &&
    recent.pct - (base?.pct ?? 0) >= LATE_JUMP
  )
    out.push({ kind: "late_spike", recent: recent.pct, base: base?.pct ?? null, n: recent.n });
  return out;
}

/** Đường xu hướng: `pts` điểm (cũ → mới) ⇒ toạ độ SVG trong khung w×h (chừa lề 3). ≥ 2 điểm mới vẽ. */
export function sparkOf(
  pts: readonly ChartPoint[],
  w = 160,
  h = 40,
): { path: string; last: { x: number; y: number } } | null {
  if (pts.length < 2) return null;
  const v = pts.map((p) => p.score);
  const lo = Math.min(...v) - 3;
  const hi = Math.max(...v) + 3;
  const x = (i: number) => 3 + (i / (pts.length - 1)) * (w - 6);
  const y = (s: number) => h - 3 - ((s - lo) / (hi - lo)) * (h - 6);
  const c = pts.map((p, i) => ({ x: x(i), y: y(p.score) }));
  return {
    path: c.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    last: c[c.length - 1] as { x: number; y: number },
  };
}
