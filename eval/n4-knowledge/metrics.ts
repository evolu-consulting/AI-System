// N4 eval 0.11 · độ đo thuần: so khớp đoạn vàng (không dấu), recall@k theo nhóm, MRR, phủ ý đáp án trong ngữ cảnh, p95,
// PRNG có hạt (thứ tự câu hỏi tất định), tải CPU máy trong lúc đo.
import { cpus } from "node:os";
import { foldVi } from "../../apps/hub-api/src/modules/knowledge/domain/text.rules";

export type GoldRef = { doc: string; has: string };
export type Question = {
  id: string;
  kind: "fact" | "clause" | "number_date" | "multi_hop" | "no_answer";
  corpus: string;
  q: string;
  answer: string;
  facts: string[][];
  gold: GoldRef[][];
  leak_probe?: boolean;
};
/** Một đoạn đã xếp hạng, quy về khoá ổn định `doc#ord` (id uuid đổi mỗi lần nạp). */
export type Ranked = { doc: string; ord: number; text: string };

const norm = (s: string): string => foldVi(s).replace(/\s+/g, " ");

export const isGold = (r: Ranked, g: GoldRef): boolean =>
  r.doc === g.doc && norm(r.text).includes(norm(g.has));

/** Hạng (1-based) của đoạn đầu tiên khớp nhóm; 0 nếu không có. */
export function groupRank(ranked: readonly Ranked[], group: readonly GoldRef[]): number {
  const i = ranked.findIndex((r) => group.some((g) => isGold(r, g)));
  return i + 1;
}

/** Tỉ lệ nhóm vàng có đoạn trong top-k. */
export function recallAtK(
  ranked: readonly Ranked[],
  gold: readonly GoldRef[][],
  k: number,
): number {
  if (gold.length === 0) return Number.NaN;
  const top = ranked.slice(0, k);
  return gold.filter((g) => groupRank(top, g) > 0).length / gold.length;
}

/** 1/hạng của đoạn vàng ĐẦU TIÊN (bất kỳ nhóm). */
export function reciprocalRank(ranked: readonly Ranked[], gold: readonly GoldRef[][]): number {
  if (gold.length === 0) return Number.NaN;
  const ranks = gold.map((g) => groupRank(ranked, g)).filter((r) => r > 0);
  return ranks.length ? 1 / Math.min(...ranks) : 0;
}

/** Tỉ lệ ý đáp án xuất hiện (một trong các cách viết) trong ngữ cảnh top-k. */
export function factCoverage(
  ranked: readonly Ranked[],
  facts: readonly string[][],
  k: number,
): number {
  if (facts.length === 0) return Number.NaN;
  const ctx = norm(
    ranked
      .slice(0, k)
      .map((r) => r.text)
      .join("\n"),
  );
  return facts.filter((alts) => alts.some((a) => ctx.includes(norm(a)))).length / facts.length;
}

export const mean = (xs: readonly number[]): number => {
  const v = xs.filter((x) => !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN;
};

export const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? Number.NaN;
};

/** mulberry32 — PRNG có hạt. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Ảnh chụp thời gian CPU toàn máy; `busyPct(a, b)` = % bận trung bình mọi lõi giữa hai ảnh. */
export const cpuSnap = () => cpus().map((c) => ({ ...c.times }));
export function busyPct(a: ReturnType<typeof cpuSnap>, b: ReturnType<typeof cpuSnap>): number {
  let busy = 0;
  let all = 0;
  b.forEach((t, i) => {
    const s = a[i];
    if (!s) return;
    const idle = t.idle - s.idle;
    const tot =
      t.user + t.nice + t.sys + t.irq + t.idle - (s.user + s.nice + s.sys + s.irq + s.idle);
    busy += tot - idle;
    all += tot;
  });
  return all > 0 ? (100 * busy) / all : Number.NaN;
}
