// HUB-FR-75 · H2c-R27–R29 · PL2, PL11, PL13 · luật thuần sweeper (plan-rules §4).

/** R27: file chưa gắn tin quá hạn này thì xoá. */
export const UNBOUND_TTL_MS = 86_400_000;
/** Mục trên kho cũ hơn mức này mới xét mồ côi. */
export const ORPHAN_AGE_MS = 3_600_000;
export const SWEEP_BATCH = 500;

/** `nowMs − mtimeMs > ORPHAN_AGE_MS` ∧ (`partial` ∨ khoá không còn hàng sống). */
export function orphanCandidate(
  e: { key: string; partial: boolean; mtimeMs: number },
  nowMs: number,
  live: ReadonlySet<string>,
): boolean {
  return nowMs - e.mtimeMs > ORPHAN_AGE_MS && (e.partial || !live.has(e.key));
}
