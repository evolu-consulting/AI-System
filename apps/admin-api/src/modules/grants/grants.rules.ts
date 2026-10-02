// ADM-FR-32, ADM-FR-35, ADM-BR-12 · luật grant dạng hàm thuần (plan M3 §4; M3-R07…R09). Không import I/O.
import { CORE_FEATURE_KEY, type ErrorCode, type MatrixRowState } from "@ai/contracts";

export type RuleError = { code: ErrorCode; details?: unknown };
export type PairKey = { featureId: string; groupId: string };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** featureId tăng rồi groupId tăng (so chuỗi uuid chữ thường = thứ tự byte của Postgres) — thứ tự khoá hạng 11. */
export function comparePairs(a: PairKey, b: PairKey): number {
  return cmp(a.featureId, b.featureId) || cmp(a.groupId, b.groupId);
}

export const pairId = (p: PairKey): string => `${p.featureId}:${p.groupId}`;

export type GrantFeature = { id: string; key: string; entitled: boolean };

/**
 * Thứ tự: bất kỳ feature `core` (add ∪ remove) → CORE_FEATURE_PROTECTED; feature trong `addIds` mà !entitled →
 * NOT_ENTITLED {feature_ids sắp tăng, không trùng}. `remove` không cần entitlement.
 */
export function checkGrantFeatures(
  features: readonly GrantFeature[],
  addIds: ReadonlySet<string>,
): RuleError | null {
  if (features.some((f) => f.key === CORE_FEATURE_KEY)) return { code: "CORE_FEATURE_PROTECTED" };
  const missing = [
    ...new Set(features.filter((f) => addIds.has(f.id) && !f.entitled).map((f) => f.id)),
  ].sort(cmp);
  return missing.length > 0 ? { code: "NOT_ENTITLED", details: { feature_ids: missing } } : null;
}

/**
 * existing = pairId của hàng thấy ở lock pass. insert = add ∖ existing; delete = remove ∩ existing;
 * unchanged = |add ∩ existing| + |remove ∖ existing|; insert/delete sắp theo comparePairs.
 * CHỈ để sắp thứ tự và đếm dự kiến — số trả client lấy từ `returning` của câu ghi (readiness M3 #8, plan §5.5).
 */
export function planBatch(
  existing: ReadonlySet<string>,
  add: readonly PairKey[],
  remove: readonly PairKey[],
): { insert: PairKey[]; delete: PairKey[]; unchanged: number } {
  const insert = add.filter((p) => !existing.has(pairId(p))).sort(comparePairs);
  const del = remove.filter((p) => existing.has(pairId(p))).sort(comparePairs);
  const unchanged = add.length - insert.length + (remove.length - del.length);
  return { insert, delete: del, unchanged };
}

/**
 * core → "core"; entitled → "entitled"; ¬entitled ∧ revoked ∧ grantCount > 0 → "revoked"; còn lại → "none"
 * (chưa từng mở, hoặc đã thu hồi và không còn grant; FE ẩn mặc định, plan-frontend D11).
 */
export function matrixRowState(f: {
  key: string;
  entitled: boolean;
  revoked: boolean;
  grantCount: number;
}): MatrixRowState {
  if (f.key === CORE_FEATURE_KEY) return "core";
  if (f.entitled) return "entitled";
  return f.revoked && f.grantCount > 0 ? "revoked" : "none";
}
