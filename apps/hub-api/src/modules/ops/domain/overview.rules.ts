// CR-121 · cr121-c3a-overview-api · luật THUẦN của "Tổng quan admin platform": tỷ lệ, p95 phút, dựng chuỗi 7 ngày / 24 giờ từ
// dòng gom theo cửa sổ, đếm từ kết quả check `flow_coverage`. Không DB, không đồng hồ (`now` truyền vào).
import { OVERVIEW_HOURS, OVERVIEW_SERIES_DAYS } from "@ai/contracts/hub-admin";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** % làm tròn 1 chữ số; mẫu số 0 ⇒ `null` (chưa có dữ liệu, KHÔNG phải 0%). */
export function ratePct(part: number, total: number): number | null {
  return total > 0 ? round1((part / total) * 100) : null;
}

/** Giây → phút (1 chữ số); `null` giữ nguyên. */
export function minutesOf(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined ? null : round1(seconds / 60);
}

/** Dòng gom theo cửa sổ trượt: `k` = số cửa sổ lùi từ `now` (0 = 24 giờ gần nhất). */
type Bucketed = { k: number };

/** Dựng chuỗi 7 ngày CŨ → MỚI ([6] = k 0). Thiếu cửa sổ ⇒ `empty`; `k` ngoài 0–6 bị bỏ. */
export function dailySeries<R extends Bucketed, T>(
  rows: readonly R[],
  pick: (r: R) => T,
  empty: T,
): T[] {
  const out: T[] = Array.from({ length: OVERVIEW_SERIES_DAYS }, () => empty);
  for (const r of rows) {
    if (r.k >= 0 && r.k < OVERVIEW_SERIES_DAYS) out[OVERVIEW_SERIES_DAYS - 1 - r.k] = pick(r);
  }
  return out;
}

/** Giá trị của cửa sổ k (0 = hôm nay, 1 = hôm qua) trong chuỗi đã dựng. */
export const atWindow = <T>(series: readonly T[], k: number): T =>
  series[OVERVIEW_SERIES_DAYS - 1 - k] as T;

export type HourRow = { h: number; ok: number; err: number };
export type HourCol = { hour_start: string; ok: number; error: number };

/** 24 cột CŨ → MỚI; cột [23] = giờ gần nhất [now−1h, now). `hour_start` = đầu cửa sổ giờ đó. */
export function hourlyColumns(rows: readonly HourRow[], now: Date): HourCol[] {
  const cols: HourCol[] = Array.from({ length: OVERVIEW_HOURS }, (_, i) => ({
    hour_start: new Date(now.getTime() - (OVERVIEW_HOURS - i) * HOUR_MS).toISOString(),
    ok: 0,
    error: 0,
  }));
  for (const r of rows) {
    const col = cols[OVERVIEW_HOURS - 1 - r.h];
    if (r.h >= 0 && r.h < OVERVIEW_HOURS && col) {
      col.ok = r.ok;
      col.error = r.err;
    }
  }
  return cols;
}

/** Cửa sổ tháng UTC chứa `now`: [đầu tháng, đầu tháng sau). */
export function monthWindow(now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
}

type CoverageValue = {
  gap_count?: number;
  gaps?: { tenant: string }[];
  unrouted?: string[];
  broken?: string[];
} | null;

/** Số công ty có việc chưa gán quy trình: số tên công ty khác nhau trong danh sách; danh sách bị cắt ⇒ cận trên = `gap_count`. */
export function unroutedCompanies(v: CoverageValue): number {
  if (!v) return 0;
  const gaps = v.gaps ?? [];
  const total = v.gap_count ?? 0;
  if (total === 0) return 0;
  return total > gaps.length ? total : new Set(gaps.map((g) => g.tenant)).size;
}

/** Cấu hình nửa vời (CR-121 D-4): công ty còn lượt duyệt mà khe không còn quy trình + quy trình đã gán nhưng không chạy được. */
export function halfConfigured(v: CoverageValue): number {
  if (!v) return 0;
  return new Set([...(v.unrouted ?? []), ...(v.broken ?? [])]).size;
}

/** Trễ hàng đợi nền = lớn hơn của (việc chờ lâu nhất, hẹn giờ quá hạn lâu nhất), giây, làm tròn. */
export function queueLagSeconds(oldestWaitS: number | null, timerOverdueS: number | null): number {
  return Math.round(Math.max(oldestWaitS ?? 0, timerOverdueS ?? 0, 0));
}

/** % đã dùng của hạn mức USD gộp; chưa có hạn mức USD ⇒ `null`. */
export function usedPct(usedUsd: number, limitUsd: number): number | null {
  return limitUsd > 0 ? round1((usedUsd / limitUsd) * 100) : null;
}

/** Chuẩn hoá khoá cache: cùng tham số ⇒ cùng khoá. */
export const cacheKey = (p: { stuck_hours: number; quota_pct: number }): string =>
  `${p.stuck_hours}:${p.quota_pct}`;

export type Cached<T> = { at: number; value: T };

/** Còn hạn khi tuổi < ttl (ms); đồng hồ lùi (tuổi < 0) ⇒ coi như hết hạn. */
export function fresh<T>(c: Cached<T> | undefined, nowMs: number, ttlMs: number): c is Cached<T> {
  return c !== undefined && nowMs - c.at >= 0 && nowMs - c.at < ttlMs;
}
