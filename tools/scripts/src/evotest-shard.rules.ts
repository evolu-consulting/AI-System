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
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Chừa cho prod + dự án khác cùng máy. */
export const RESERVED_CORES = 2;
export const MAX_E2E_JOBS = 9; // = số Redis DB e2e (REDIS_DBS)
export const MAX_INT_WORKERS = 12; // = MAX_WORKERS của test-int-par

/**
 * Chia slot trống và lõi: `-Step all` ⇒ 1 slot int + còn lại e2e; `-Step e2e` ⇒ mọi slot trống cho e2e (tối đa mỗi việc một slot).
 * Lõi dùng được = cores − RESERVED; mỗi slot ≥ 2 lõi, ≤ 8; int nhận ≥ 4 lõi (workers = lõi, ≤ 12); việc e2e cùng lúc = lõi của slot (2..9).
 */
export function planSlots(o: {
  step: "all" | "e2e";
  free: number;
  cores: number;
  jobs: number;
}): SlotPlan {
  const free = Math.max(1, Math.floor(o.free));
  const intShard = o.step === "all" && free >= 2;
  const e2eShards = clamp(free - (intShard ? 1 : 0), 1, Math.max(1, o.jobs));
  const used = e2eShards + (intShard ? 1 : 0);
  const usable = Math.max(2, o.cores - RESERVED_CORES);
  const share = Math.floor(usable / used);
  const intCpus = intShard ? clamp(Math.max(4, share), 2, 8) : 0;
  const e2eCpus = clamp(Math.floor((usable - intCpus) / e2eShards), 2, 8);
  return {
    intShard,
    intCpus,
    intWorkers: intShard ? clamp(intCpus, 1, MAX_INT_WORKERS) : 0,
    e2eShards,
    e2eCpus,
    e2eJobs: clamp(e2eCpus, 2, MAX_E2E_JOBS),
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
