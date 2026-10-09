// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-BR-10, ADM-BR-12 · luật thuần features (plan M2 §4). Không import I/O.
import { CORE_FEATURE_KEY as CORE, type ErrorCode, type FeatureStatus } from "@ai/contracts";
import { sameIdSet, sameJson } from "../../lib/json";

export type RuleError = { code: ErrorCode; details?: unknown };

export const CORE_FEATURE_KEY = CORE;

export const isCore = (f: { key: string }): boolean => f.key === CORE_FEATURE_KEY;

/** `core` chỉ giữ `on` (M2-R20); feature thường đổi tự do (kill switch FR-33, beta FR-34). */
export function checkFeatureStatus(
  f: { key: string },
  next: FeatureStatus | undefined,
): RuleError | null {
  return isCore(f) && next !== undefined && next !== "on"
    ? { code: "CORE_FEATURE_PROTECTED" }
    : null;
}

/** `core` không xoá được. Command chỉ thuộc feature này được phép → thành "chưa gắn feature" (CR-055 bỏ M2-R21). */
export function checkFeatureDelete(f: { key: string }): RuleError | null {
  return isCore(f) ? { code: "CORE_FEATURE_PROTECTED" } : null;
}

/** `core` tự hiệu lực mọi tenant, không có hàng entitlement (RD#7). */
export function checkEntitlementTarget(f: { key: string }): RuleError | null {
  return isCore(f) ? { code: "CORE_FEATURE_PROTECTED" } : null;
}

/** Hiệu lực cho người dùng (M2-R23): `on` | `beta` (lọc beta-testers là M3). */
export const isFeatureEffective = (status: FeatureStatus): boolean => status !== "off";

const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

export function diffIds(
  cur: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const c = new Set(cur);
  const n = new Set(next);
  return {
    added: sortedUnique([...n].filter((x) => !c.has(x))),
    removed: sortedUnique([...c].filter((x) => !n.has(x))),
  };
}

export type FeatureState = {
  name: { vi: string; en?: string };
  description: { vi?: string; en?: string };
  icon: string;
  status: FeatureStatus;
  commandIds: string[];
};

/** Trường thực sự đổi; `commandIds` so như tập. [] → không ghi, không tăng version (M2-R25). */
export function changedFeatureFields(
  cur: FeatureState,
  next: FeatureState,
): (keyof FeatureState)[] {
  const out: (keyof FeatureState)[] = [];
  if (!sameJson(cur.name, next.name)) out.push("name");
  if (!sameJson(cur.description, next.description)) out.push("description");
  if (cur.icon !== next.icon) out.push("icon");
  if (cur.status !== next.status) out.push("status");
  if (!sameIdSet(cur.commandIds, next.commandIds)) out.push("commandIds");
  return out;
}
