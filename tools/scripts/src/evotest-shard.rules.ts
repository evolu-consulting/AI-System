// tool-evotest-cache · chia LƯỢT TOÀN BỘ (`run-tests.ps1 -Step all|e2e` không -Filter) ra nhiều slot evotest chạy song song.
// Hàm thuần: chia việc e2e theo thời lượng đã đo (LPT), chia CPU/số việc trong slot theo lõi máy chủ, gộp file thời lượng.

export type JobCost = { name: string; cost: number };

/** LPT: việc nặng trước, mỗi việc vào ngăn đang nhẹ nhất; ngăn rỗng bị bỏ; thứ tự ổn định (cùng đầu vào ⇒ cùng kết quả). */
export function shardJobs(jobs: readonly JobCost[], k: number): string[][] {
  const n = Math.max(1, Math.min(Math.floor(k), jobs.length || 1));
  const bins: { names: string[]; load: number }[] = Array.from({ length: n }, () => ({
    names: [],
    load: 0,
  }));
  const sorted = [...jobs].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  for (const j of sorted) {
    const bin = bins.reduce((m, b) => (b.load < m.load ? b : m));
    bin.names.push(j.name);
    bin.load += j.cost;
  }
  return bins.filter((b) => b.names.length).map((b) => b.names);
}

/** Thời gian ước tính của ngăn lớn nhất (giây) - để in "dự kiến". */
export function makespan(jobs: readonly JobCost[], shards: readonly string[][]): number {
  const cost = new Map(jobs.map((j) => [j.name, j.cost]));
  return Math.max(0, ...shards.map((s) => s.reduce((a, n) => a + (cost.get(n) ?? 0), 0)));
}

export type SlotPlan = {
  /** Có một slot riêng cho int (chỉ `-Step all`). */
  intShard: boolean;
  intCpus: number;
  intWorkers: number;
  e2eShards: number;
  e2eCpus: number;
  /** Số việc e2e chạy cùng lúc trong một slot (`test-e2e-par --jobs`). */
  e2eJobs: number;
  /** Tổng tiến trình test cùng lúc (int workers + ngăn e2e × việc cùng lúc) - luôn ≤ concurrencyBudget(lõi). */
  total: number;
  budget: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const MAX_E2E_JOBS = 9; // = số Redis DB e2e (REDIS_DBS)
export const MAX_INT_WORKERS = 12; // = MAX_WORKERS của test-int-par
/** Quá tải CPU cho phép: tổng worker/việc cùng lúc ≈ lõi × 1,3 (đo: 11 ngăn × 8 worker trên 12 lõi ⇒ load 67). */
export const OVERSUBSCRIBE = 1.3;

export const concurrencyBudget = (cores: number): number =>
  Math.max(4, Math.round(cores * OVERSUBSCRIBE));

/**
 * Chia slot trống theo NGÂN SÁCH ĐỒNG THỜI B = lõi × 1,3: `-Step all` ⇒ 1 slot int (workers ≈ 30% B) + các ngăn e2e;
 * `-Step e2e` ⇒ chỉ ngăn e2e. Số ngăn e2e ≤ (phần B còn lại)/2 và ≤ số slot trống/số việc; mỗi ngăn chạy (B còn lại / số ngăn)
 * việc cùng lúc (2..9). Việc dư xếp hàng TRONG ngăn (hồ việc của test-e2e-par), không mở thêm slot. Mỗi slot ≥ 2 và ≤ 8 CPU.
 */
export function planSlots(o: {
  step: "all" | "e2e";
  free: number;
  cores: number;
  jobs: number;
}): SlotPlan {
  const free = Math.max(1, Math.floor(o.free));
  const budget = concurrencyBudget(o.cores);
  const intShard = o.step === "all" && free >= 2 && budget >= 6;
  const intWorkers = intShard ? clamp(Math.round(budget * 0.3), 2, MAX_INT_WORKERS) : 0;
  const rest = budget - intWorkers;
  const e2eShards = clamp(
    Math.min(free - (intShard ? 1 : 0), Math.max(1, o.jobs), Math.floor(rest / 2)),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const e2eJobs = clamp(Math.floor(rest / e2eShards), 2, MAX_E2E_JOBS);
  return {
    intShard,
    intCpus: intShard ? clamp(intWorkers, 2, 8) : 0,
    intWorkers,
    e2eShards,
    e2eCpus: clamp(e2eJobs, 2, 8),
    e2eJobs,
    total: intWorkers + e2eShards * e2eJobs,
    budget,
  };
}
/** Gộp thời lượng: `add` (lượt vừa xong) đè lên `base` (đã có trên máy chủ); khoá khác giữ nguyên. Bỏ số không hợp lệ. */
export function mergeTimings(
  base: Readonly<Record<string, number>>,
  add: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = { ...base };
  for (const [k, v] of Object.entries(add)) if (Number.isFinite(v) && v >= 0) out[k] = v;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
