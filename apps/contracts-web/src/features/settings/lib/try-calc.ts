// V2-L · "thử tính" điểm uy tín (thuần, tính tại chỗ theo bản nháp; ảnh hưởng lên đối tác thật lấy từ `POST /reputation/config/preview`).
// Công thức = BA §5.1: điểm dữ liệu = Σ(điểm tiêu chí × trọng số) ÷ Σ trọng số; cuối = (1−s)·dữ liệu + s·(sao × 20); mức theo ngưỡng.

import { percentOf } from "./rep-data";
import type { Cell } from "./rep-types";

export type Level = "good" | "fair" | "watch";
export const levelOf = (score: number, good: number, fair: number): Level =>
  score >= good ? "good" : score >= fair ? "fair" : "watch";

/** Hệ số độ cũ (0–1) của một việc cách đây `age` tháng; ngoài khoảng tính điểm = 0 (giống server `decayFactor`). */
export function decayAt(age: number, c: Pick<Cell, "decay" | "window_months">): number {
  if (age >= c.window_months) return 0;
  const i = c.decay.months.findIndex((m) => age < m);
  return (i < 0 ? c.decay.factors[c.decay.months.length] : c.decay.factors[i]) ?? 1;
}

/** Điểm tiêu chí = Σ(điểm việc × hệ số) ÷ Σ hệ số; mọi việc ngoài khoảng ⇒ null. */
export function criterionFromJobs(jobs: { age: number; score: number }[], c: Cell): number | null {
  const h = jobs.map((j) => decayAt(j.age, c));
  const sum = h.reduce((a, b) => a + b, 0);
  return sum ? jobs.reduce((a, j, i) => a + j.score * (h[i] ?? 0), 0) / sum : null;
}

export type CritTry = {
  rows: { key: string; pct: number; part: number }[];
  data: number;
  final: number;
};
/** Điểm cuối từ điểm mẫu từng tiêu chí bật; `stars` 0 ⇒ chưa có đánh giá (dùng 100% điểm dữ liệu). */
export function tryCriteria(
  c: Cell,
  scores: Record<string, number>,
  share: number,
  stars: number,
): CritTry {
  const pct = percentOf(c);
  const on = c.criteria.filter((x) => x.enabled);
  const tw = on.reduce((a, x) => a + (pct[x.key] ?? 0), 0) || 1;
  const rows = on.map((x) => ({
    key: x.key,
    pct: ((pct[x.key] ?? 0) / tw) * 100,
    part: ((scores[x.key] ?? 0) * (pct[x.key] ?? 0)) / tw,
  }));
  const data = rows.reduce((a, r) => a + r.part, 0);
  const st = share > 0 && stars > 0 ? Math.min(5, stars) * 20 : null;
  const final = Math.round(st === null ? data : ((100 - share) / 100) * data + (share / 100) * st);
  return { rows, data, final };
}

/** Điểm đánh giá lệch điểm dữ liệu quá `gap` ⇒ phải ghi lý do. */
export const needsReason = (data: number, stars: number, gap: number): boolean =>
  stars > 0 && Math.abs(Math.min(5, stars) * 20 - data) > gap;
