// HUB-FR-75 · H2c-R27–R29 · PL2, PL11, PL13 · luật thuần sweeper (plan-rules §4). B0: chỉ chữ ký — B10.

/** R27: file chưa gắn tin quá hạn này thì xoá. */
export const UNBOUND_TTL_MS = 86_400_000;
/** Mục trên kho cũ hơn mức này mới xét mồ côi. */
export const ORPHAN_AGE_MS = 3_600_000;
export const SWEEP_BATCH = 500;

/** `nowMs − mtimeMs > ORPHAN_AGE_MS` ∧ (`partial` ∨ khoá không còn hàng sống). */
export function orphanCandidate(
  _e: { key: string; partial: boolean; mtimeMs: number },
  _nowMs: number,
  _live: ReadonlySet<string>,
): boolean {
  throw new Error("not implemented: orphanCandidate");
}
