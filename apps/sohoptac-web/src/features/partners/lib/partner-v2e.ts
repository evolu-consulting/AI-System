// REP-v3-ui · V2-E (BA v2.0 §5.1) · luật thuần hiển thị điểm vai × nhóm SP khi `engine = v2e`: cột "Góp", các bước tới điểm cuối,
// biểu đồ 3/6/12 tháng + ngưỡng, đánh giá sao cần lý do. (Khôi phục từ V2-I, bỏ phần dùng chung đã có ở `partner-v2.ts`.)
import type { RepCellOut, RepCriterionOut, RepHistory } from "@ai/contracts";

export { RANGES, type Range } from "./partner-v2";
// ---------- bảng tính điểm (DT-02) ----------
export type CriterionLine = RepCriterionOut & {
  /** Tỷ lệ thật sau khi bỏ tiêu chí chưa có dữ liệu, % (cộng lại = 100). */
  share: number | null;
  /** Điểm góp vào điểm dữ liệu = share × điểm / 100. */
  gives: number | null;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Cột "Góp": tiêu chí chưa có điểm bị bỏ, trọng số còn lại chia lại cho đủ 100% (BA §5.1 bước 2). */
export function criterionLines(criteria: readonly RepCriterionOut[]): CriterionLine[] {
  const w = criteria.reduce((a, c) => a + (c.score === null ? 0 : c.weight), 0);
  return criteria.map((c) => {
    if (c.score === null || w <= 0) return { ...c, share: null, gives: null };
    const share = (c.weight / w) * 100;
    return { ...c, share: r1(share), gives: r1((share * c.score) / 100) };
  });
}

export type FinalSteps = {
  /** Bước 2: điểm dữ liệu (tổng Góp). */
  data: number | null;
  /** Bước 3: sao trung bình (1–5) và điểm sao ×20; tỷ trọng s %. */
  stars: number | null;
  starsScore: number | null;
  share: number;
  /** Điểm của nhóm sau khi trộn sao. */
  score: number | null;
};
/** Các bước tới điểm cuối của một nhóm: (1 − s) × dữ liệu + s × sao × 20 (chỉ khi có sao; chưa có dữ liệu thì lấy sao). */
export function finalSteps(cell: RepCellOut, manualShare: number): FinalSteps {
  return {
    data: cell.data_score,
    stars: cell.stars,
    starsScore: cell.stars === null ? null : Math.round(cell.stars * 20),
    share: manualShare,
    score: cell.score,
  };
}

/** Bước 4: tỷ trọng giá trị giao dịch của từng nhóm có điểm trong điểm vai (%; không có giá trị ⇒ chia đều). */
export function valueShares(cells: readonly RepCellOut[]): Map<string, number> {
  const has = cells.filter((c) => c.score !== null);
  const total = has.reduce((a, c) => a + Math.max(0, c.value), 0);
  return new Map(
    has.map((c) => [
      c.group,
      Math.round(total > 0 ? (Math.max(0, c.value) / total) * 100 : 100 / has.length),
    ]),
  );
}

// ---------- biểu đồ (DT-03) ----------
export type ChartPoint = { period: string; score: number };
/** Điểm đã chốt + điểm hiện tại (cùng tháng ⇒ lấy hiện tại), chỉ điểm có giá trị, cũ → mới. */
export function seriesOf(h: RepHistory | undefined): ChartPoint[] {
  if (!h) return [];
  const pts = new Map<string, number>();
  for (const p of h.points) if (p.score !== null) pts.set(p.period, p.score);
  if (h.current && h.current.score !== null) pts.set(h.current.period, h.current.score);
  return [...pts]
    .map(([period, score]) => ({ period, score }))
    .sort((a, b) => (a.period < b.period ? -1 : 1));
}

export type Chart = {
  w: number;
  h: number;
  x: (i: number) => number;
  y: (v: number) => number;
  grid: number[];
  /** Hai đường ngưỡng (chỉ khi nằm trong khung). */
  lines: { label: "good" | "fair"; at: number; y: number }[];
  path: string;
  dots: { x: number; y: number; period: string; score: number }[];
};
const PAD = { l: 34, r: 12, t: 14, b: 28 };

/** Hình học biểu đồ (SVG viewBox w×h): trục dưới = min(50, thấp nhất − 5 làm tròn 10), trên = 100. */
export function chartOf(
  pts: readonly ChartPoint[],
  th: { good_from: number; fair_from: number },
  w = 640,
  h = 230,
): Chart {
  const lo = pts.length
    ? Math.min(50, Math.floor((Math.min(...pts.map((p) => p.score)) - 5) / 10) * 10)
    : 50;
  const hi = 100;
  const x = (i: number) =>
    PAD.l + (pts.length <= 1 ? 0 : (i * (w - PAD.l - PAD.r)) / (pts.length - 1));
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (h - PAD.t - PAD.b);
  const grid: number[] = [];
  for (let g = lo; g <= hi; g += 10) grid.push(g);
  const dots = pts.map((p, i) => ({ x: x(i), y: y(p.score), period: p.period, score: p.score }));
  return {
    w,
    h,
    x,
    y,
    grid,
    lines: (
      [
        { label: "fair", at: th.fair_from },
        { label: "good", at: th.good_from },
      ] as const
    )
      .filter((l) => l.at > lo && l.at <= hi)
      .map((l) => ({ ...l, y: y(l.at) })),
    path: dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" "),
    dots,
  };
}
/** "2026-03" ⇒ "03/26". */
export const periodLabel = (p: string): string => `${p.slice(5, 7)}/${p.slice(2, 4)}`;

// ---------- đánh giá sao (DT-04) ----------
/** Điểm so sánh của tiêu chí (cùng luật server): điểm từ dữ liệu của chính tiêu chí, chưa có ⇒ điểm dữ liệu của nhóm. */
export const dataPointOf = (c: RepCriterionOut, cell: RepCellOut): number | null =>
  c.kind !== "manual" && c.score !== null ? c.score : cell.data_score;

/** Lệch hơn `gap` điểm so với dữ liệu ⇒ bắt lý do (chưa có dữ liệu để so ⇒ không bắt). */
export const needsReason = (stars: number, data: number | null, gap: number): boolean =>
  data !== null && Math.abs(stars * 20 - data) > gap;
