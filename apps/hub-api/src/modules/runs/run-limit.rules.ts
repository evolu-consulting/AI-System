// HUB-FR-94 · H2b-R16, R17 · giới hạn run `running` mỗi user (plan-rules, plan §5.4). Thuần.

/** Mặc định `HUB_MAX_CONCURRENT_RUNS` khi vắng (spec R16). */
export const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const MAX_CONCURRENT_RUNS_MIN = 1;
const MAX_CONCURRENT_RUNS_MAX = 20;
const DIGITS_RE = /^\d+$/;

/** R16: vượt giới hạn khi `running >= limit`. */
export function overLimit(running: number, limit: number): boolean {
  return running >= limit;
}

/** env `HUB_MAX_CONCURRENT_RUNS`: vắng → 2; số nguyên 1–20; khác → ném (không in giá trị). */
export function parseMaxConcurrentRuns(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_CONCURRENT_RUNS;
  const s = raw.trim();
  const n = DIGITS_RE.test(s) ? Number(s) : Number.NaN;
  if (!Number.isInteger(n) || n < MAX_CONCURRENT_RUNS_MIN || n > MAX_CONCURRENT_RUNS_MAX) {
    throw new Error(
      `HUB_MAX_CONCURRENT_RUNS phải là số nguyên ${MAX_CONCURRENT_RUNS_MIN}–${MAX_CONCURRENT_RUNS_MAX}`,
    );
  }
  return n;
}
