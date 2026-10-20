// V2-E · BA v2 §5.1 (4 bước) · CR-096 Q1: điểm uy tín v2 từ số đã gom ở SQL (Luật 4c). Thuần.
// 1. Điểm việc: mốc đối tác đã xác nhận = 100, lỗi do ĐỐI TÁC trừ `late_per_day` mỗi ngày trễ (lỗi mình/chưa rõ không trừ); việc
//    ghi tay = điểm của loại việc. 2. Điểm tiêu chí = bình quân điểm việc trọng số độ cũ h (bậc thang). 3. Điểm dữ liệu = bình quân
//    tiêu chí bật theo trọng số w, bỏ tiêu chí chưa có dữ liệu. 4. Điểm cuối = (1 − s)·dữ liệu + s·(sao TB × 20); chưa có đánh giá ⇒
//    = dữ liệu. Mức: dưới `min_jobs` việc ⇒ MỚI; ≥ TỐT ⇒ good; ≥ KHÁ ⇒ fair; còn lại watch (CHÚ Ý). Điểm vai = bình quân điểm các
//    nhóm theo giá trị giao dịch (giá trị 0 hết ⇒ bình quân đều).
import type {
  CellConfig,
  Criterion,
  Decay,
  JobType,
  RepGroup,
  RepRole,
  Settings,
} from "./rep-config.rules";

/** Một nguồn đã gom: số việc, Σh, Σh·điểm việc (mốc; việc ghi tay để 0 — điểm theo loại việc). */
export type SrcAgg = { n: number; wh: number; whs: number };
export type CellInput = {
  party: string;
  role: RepRole;
  grp: RepGroup;
  /** `m:<loại mốc>` (mốc việc của đối tác) · `tx` (mốc việc của mình — chỉ đếm giao dịch) · `j:<loại việc>`. */
  sources: Record<string, SrcAgg>;
  value: number;
  /** Tiêu chí ⇒ sao trung bình (lượt mới nhất của mỗi người). */
  stars: Record<string, number>;
};
export type Level = "good" | "fair" | "watch" | "new";
export type CriterionOut = {
  key: string;
  label: string;
  kind: Criterion["kind"];
  weight: number;
  score: number | null;
  n: number;
};
export type CellScore = {
  group: RepGroup;
  role: RepRole;
  score: number | null;
  data_score: number | null;
  stars: number | null;
  level: Level;
  jobs: number;
  value: number;
  criteria: CriterionOut[];
};
export type RoleScore = { score: number | null; level: Level; jobs: number };
export type ScoreCtx = { cell: CellConfig; settings: Settings; jobTypes: readonly JobType[] };

const round = (v: number | null): number | null => (v === null ? null : Math.round(v));
const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Tháng tròn đã qua giữa hai ngày ISO (≡ Postgres `age()`: năm × 12 + tháng). */
export function ageMonths(at: string, today: string): number {
  const [y1, m1, d1] = at.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split("-").map(Number) as [number, number, number];
  const m = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, m);
}
const pad = (n: number) => String(n).padStart(2, "0");
/** Hôm nay − n tháng (ngày kẹp về cuối tháng như Postgres `date - interval 'n months'`). */
export function monthsBefore(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - n;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  const dim = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, dim))}`;
}
/** Hệ số h của ngày `at` (≡ SQL `rep.sql.ts`: tuổi < m tháng ⟺ `at` > hôm nay − m tháng). */
export function decayAt(at: string, today: string, d: Decay): number {
  const i = d.months.findIndex((m) => at > monthsBefore(today, m));
  return (i < 0 ? d.factors[d.months.length] : d.factors[i]) ?? 1;
}
/** Hệ số h theo bậc thang (`months` tăng dần, `factors` nhiều hơn một). */
export function decayFactor(age: number, d: Decay): number {
  const i = d.months.findIndex((m) => age < m);
  return (i < 0 ? d.factors[d.months.length] : d.factors[i]) ?? 1;
}
/** Điểm một mốc: chỉ lỗi do đối tác trừ điểm theo ngày trễ. */
export const milestoneScore = (late: number, fault: string | null, perDay: number): number =>
  fault === "partner" ? clamp(100 - perDay * Math.max(0, late)) : 100;

export function levelOf(score: number | null, jobs: number, s: Settings): Level {
  if (score === null || jobs < s.min_jobs) return "new";
  return score >= s.good_from ? "good" : score >= s.fair_from ? "fair" : "watch";
}

type Pt = { score: number | null; n: number };
const NONE: Pt = { score: null, n: 0 };
/** Tiêu chí bật đã "biên dịch" theo danh mục loại việc: khoá nguồn `j:<loại>` + điểm việc (Luật 4c: dựng một lần mỗi cấu hình). */
type Item = { c: Criterion; jobs: { src: string; score: number }[] };
const plans = new WeakMap<CellConfig, { jt: readonly JobType[]; items: Item[] }>();
function planOf(cell: CellConfig, jobTypes: readonly JobType[]): Item[] {
  const hit = plans.get(cell);
  if (hit && hit.jt === jobTypes) return hit.items;
  const items = cell.criteria
    .filter((c) => c.enabled)
    .map((c) => ({
      c,
      jobs: jobTypes
        .filter((j) => j.criterion === c.key)
        .map((j) => ({ src: `j:${j.key}`, score: j.score })),
    }));
  plans.set(cell, { jt: jobTypes, items });
  return items;
}

/** Giao dịch của ô (mốc đã xác nhận, mọi việc của ai; Σh) + số việc của đối tác (mốc việc của đối tác + việc ghi tay). */
function totalsOf(src: Record<string, SrcAgg>): { txN: number; txWh: number; jobs: number } {
  let txN = 0;
  let txWh = 0;
  let jobs = 0;
  for (const k in src) {
    const s = src[k] as SrcAgg;
    const m = k.charCodeAt(0) === 109; // "m:"
    if (m || k === "tx") {
      txN += s.n;
      txWh += s.wh;
    }
    if (k !== "tx") jobs += s.n;
  }
  return { txN, txWh, jobs };
}

/** Một tiêu chí: ontime = Σh·điểm / Σh của loại mốc; jobs = bình quân điểm loại việc; bad_count = 100 − mức trừ × lần / 10 giao
 * dịch; manual = sao × 20. */
function scoreOf(it: Item, inp: CellInput, t: { txN: number; txWh: number }): Pt {
  const { c } = it;
  if (c.kind === "ontime") {
    const s = inp.sources[`m:${c.milestone}`];
    return s && s.wh > 0 ? { score: s.whs / s.wh, n: s.n } : NONE;
  }
  if (c.kind === "manual") {
    const st = inp.stars[c.key];
    return st === undefined ? NONE : { score: st * 20, n: 1 };
  }
  const { wh, whs, n } = jobSums(it, inp.sources);
  if (c.kind === "jobs") return wh > 0 ? { score: whs / wh, n } : NONE;
  if (n === 0 && t.txN === 0) return NONE;
  return { score: clamp(100 - (c.penalty ?? 10) * ((10 * wh) / Math.max(t.txWh, 1))), n };
}

/** Σh, Σh·điểm loại việc, số việc của các loại việc gắn tiêu chí. */
function jobSums(it: Item, src: Record<string, SrcAgg>) {
  let wh = 0;
  let whs = 0;
  let n = 0;
  for (const j of it.jobs) {
    const s = src[j.src];
    if (!s) continue;
    wh += s.wh;
    whs += s.wh * j.score;
    n += s.n;
  }
  return { wh, whs, n };
}

/** Điểm một tiêu chí (null = chưa có dữ liệu). */
export function criterionScore(c: Criterion, inp: CellInput, jobTypes: readonly JobType[]): Pt {
  const jobs = jobTypes
    .filter((j) => j.criterion === c.key)
    .map((j) => ({ src: `j:${j.key}`, score: j.score }));
  return scoreOf({ c, jobs }, inp, totalsOf(inp.sources));
}

/** Số việc của đối tác trong ô (mốc việc của đối tác + việc ghi tay) — cho nhãn MỚI. */
export const jobsOf = (src: Record<string, SrcAgg>): number => totalsOf(src).jobs;

/** Bước 4: trộn điểm dữ liệu với sao. */
export function blend(data: number | null, stars: number | null, sharePct: number): number | null {
  if (stars === null) return data;
  if (data === null) return stars * 20;
  const s = sharePct / 100;
  return (1 - s) * data + s * stars * 20;
}

/** Sao TB trên các tiêu chí đang bật có lượt chấm. */
function starsOf(inp: CellInput, items: Item[]): number | null {
  let sum = 0;
  let n = 0;
  for (const it of items) {
    const v = inp.stars[it.c.key];
    if (v === undefined) continue;
    sum += v;
    n++;
  }
  return n ? sum / n : null;
}

/** Điểm một ô (đối tác × vai × nhóm). */
export function cellScore(inp: CellInput, x: ScoreCtx): CellScore {
  const items = planOf(x.cell, x.jobTypes);
  const t = totalsOf(inp.sources);
  let w = 0;
  let ws = 0;
  const criteria: CriterionOut[] = items.map((it) => {
    const p = scoreOf(it, inp, t);
    if (p.score !== null) {
      w += it.c.weight;
      ws += it.c.weight * p.score;
    }
    const { key, label, kind, weight } = it.c;
    return { key, label, kind, weight, score: round(p.score), n: p.n };
  });
  const data = w > 0 ? ws / w : null;
  const stars = starsOf(inp, items);
  const score = round(blend(data, stars, x.settings.manual_share));
  return {
    group: inp.grp,
    role: inp.role,
    score,
    data_score: round(data),
    stars: stars === null ? null : Math.round(stars * 100) / 100,
    level: levelOf(score, t.jobs, x.settings),
    jobs: t.jobs,
    value: inp.value,
    criteria,
  };
}

/** Điểm vai: bình quân điểm các nhóm có điểm theo giá trị giao dịch; số việc cộng dồn. */
export function roleScore(cells: readonly CellScore[], s: Settings): RoleScore {
  const jobs = cells.reduce((a, c) => a + c.jobs, 0);
  const has = cells.filter((c) => c.score !== null);
  if (!has.length) return { score: null, level: "new", jobs };
  const total = has.reduce((a, c) => a + Math.max(0, c.value), 0);
  const wOf = (c: CellScore) => (total > 0 ? Math.max(0, c.value) / total : 1 / has.length);
  const score = Math.round(has.reduce((a, c) => a + wOf(c) * (c.score as number), 0));
  return { score, level: levelOf(score, jobs, s), jobs };
}

/**
 * "Thử tính" mẫu (BA bảng Cài đặt: "điểm từ 3 việc mẫu theo độ cũ"): 3 việc 2 / 8 / 14 tháng trước, điểm 100 / 80 / 60 ⇒ điểm tiêu
 * chí theo bậc thang của bản nháp.
 */
export function decaySample(d: Decay): {
  jobs: { age_months: number; score: number; h: number }[];
  criterion_score: number;
} {
  const jobs = [
    [2, 100],
    [8, 80],
    [14, 60],
  ].map(([age, score]) => ({
    age_months: age as number,
    score: score as number,
    h: decayFactor(age as number, d),
  }));
  const wh = jobs.reduce((a, j) => a + j.h, 0);
  return {
    jobs,
    criterion_score: Math.round((jobs.reduce((a, j) => a + j.h * j.score, 0) / wh) * 10) / 10,
  };
}
