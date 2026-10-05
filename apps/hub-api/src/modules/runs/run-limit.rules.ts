// HUB-FR-94 · H2b-R16, R17 · giới hạn run `running` mỗi user (plan-rules, plan §5.4). Thuần. B0: chỉ chữ ký (B5).

/** R16: vượt giới hạn khi `running >= limit`. */
export function overLimit(_running: number, _limit: number): boolean {
  throw new Error("not implemented: overLimit");
}

/** env `HUB_MAX_CONCURRENT_RUNS`: vắng → 2; số nguyên 1–20; khác → ném. */
export function parseMaxConcurrentRuns(_raw: string | undefined): number {
  throw new Error("not implemented: parseMaxConcurrentRuns");
}
