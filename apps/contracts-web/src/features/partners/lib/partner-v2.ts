// V2-I · DT-01..07 · BA v2 §3.2/§4.3/§5.1: luật thuần của Đối tác UI v2 (không React) — gom danh sách, bảng tính điểm (Góp), các bước tới
// điểm cuối, biểu đồ 3/6/12 tháng, lọc HĐ theo giai đoạn, đánh giá sao cần lý do, tham số URL.
import type {
  PartnerContractRow,
  PartnerWebLine,
  RepCellOut,
  RepCriterionOut,
  RepHistory,
  RepLevel,
  RepPartnerRow,
  RepRole,
} from "@ai/contracts";

export const ROLES: readonly RepRole[] = ["supplier", "customer", "commission_payer"];
export const TABS = ["overview", "contracts", "review"] as const;
export type Tab = (typeof TABS)[number];
export const RANGES = [3, 6, 12] as const;
export type Range = (typeof RANGES)[number];

export type PartnersSearch = { party?: string; role?: RepRole; tab?: Tab; range?: Range };
const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;

/** Tham số URL của `/partners`: có `party` ⇒ trang chi tiết; giá trị lạ bị bỏ; mặc định (tab tổng quan, 12 tháng) không ghi. */
export function parsePartnersSearch(s: Record<string, unknown>): PartnersSearch {
  const party = text(s.party, 300);
  if (!party) return {};
  const role = ROLES.find((r) => r === s.role);
  const tab = s.tab === "contracts" || s.tab === "review" ? s.tab : undefined;
  const range =
    s.range === 3 || s.range === "3" ? 3 : s.range === 6 || s.range === "6" ? 6 : undefined;
  return { party, ...(role ? { role } : {}), ...(tab ? { tab } : {}), ...(range ? { range } : {}) };
}

// ---------- danh sách (DT-01) ----------
export type PartyItem = {
  party: string;
  name: string;
  roles: RepPartnerRow[];
  contracts: number;
  /** Mức xấu nhất trong các vai (CHÚ Ý > KHÁ > TỐT > MỚI) — để lọc "Cần chú ý" và tô dòng. */
  worst: RepLevel;
};
const RANK: Record<RepLevel, number> = { watch: 0, fair: 1, good: 2, new: 3 };
export const worstOf = (rows: readonly { level: RepLevel }[]): RepLevel =>
  rows.reduce<RepLevel>((w, r) => (RANK[r.level] < RANK[w] ? r.level : w), "new");

/** Một dòng mỗi đối tác (gộp các vai), tên rồi khoá; số HĐ từ `contract-counts`. */
export function partiesOf(
  rows: readonly RepPartnerRow[] | undefined,
  counts: ReadonlyMap<string, number>,
): PartyItem[] {
  const by = new Map<string, RepPartnerRow[]>();
  for (const r of rows ?? []) by.set(r.party, [...(by.get(r.party) ?? []), r]);
  return [...by].map(([party, rs]) => {
    const roles = [...rs].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    return {
      party,
      name: roles[0]?.name ?? party,
      roles,
      contracts: counts.get(party) ?? 0,
      worst: worstOf(roles),
    };
  });
}

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

// ---------- HĐ (DT-06) ----------
export const STAGES = ["all", "not_started", "in_progress", "done"] as const;
export type StageFilter = (typeof STAGES)[number];
export function stageCounts(rows: readonly PartnerContractRow[]): Record<StageFilter, number> {
  const c: Record<StageFilter, number> = {
    all: rows.length,
    not_started: 0,
    in_progress: 0,
    done: 0,
  };
  for (const r of rows) c[r.stage] += 1;
  return c;
}
export const byStage = (
  rows: readonly PartnerContractRow[],
  f: StageFilter,
): PartnerContractRow[] => (f === "all" ? [...rows] : rows.filter((r) => r.stage === f));

// ---------- đánh giá sao (DT-04) ----------
/** Điểm so sánh của tiêu chí (cùng luật server): điểm từ dữ liệu của chính tiêu chí, chưa có ⇒ điểm dữ liệu của nhóm. */
export const dataPointOf = (c: RepCriterionOut, cell: RepCellOut): number | null =>
  c.kind !== "manual" && c.score !== null ? c.score : cell.data_score;

/** Lệch hơn `gap` điểm so với dữ liệu ⇒ bắt lý do (chưa có dữ liệu để so ⇒ không bắt). */
export const needsReason = (stars: number, data: number | null, gap: number): boolean =>
  data !== null && Math.abs(stars * 20 - data) > gap;

// ---------- tìm internet (DT-07) ----------
/** Dòng kết quả ⇒ nội dung ghi chú (≤ 2000 ký tự): "Tiêu đề: tóm tắt (nguồn)". */
export function noteOfLine(l: PartnerWebLine): string {
  const body = l.summary ? `${l.title}: ${l.summary}` : l.title;
  return (l.source ? `${body} (${l.source})` : body).slice(0, 2000);
}
