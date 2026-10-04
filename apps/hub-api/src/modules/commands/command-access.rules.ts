// HUB-FR-76, HUB-BR-06 · H2a P5, Q4 · lệnh user dùng được = `visible` của `computeEffectiveAccess` Admin
// (`apps/admin-api/src/modules/access/access.rules.ts`). CHÉP kiểu đầu vào, không import chéo app; test đối chiếu
// `tests/acceptance/H2a/rules/access-parity.test.ts`. Nợ: gộp `packages/access` khi combine.
import { CORE_FEATURE_KEY, type FeatureStatus } from "@ai/contracts";

export type AccessUser = {
  id: string;
  active: boolean;
  lockedByTenant: boolean;
  tenantActive: boolean;
  groupIds: readonly string[];
};
export type AccessFeature = {
  id: string;
  key: string;
  status: FeatureStatus;
  entitled: boolean;
  grantGroupIds: readonly string[];
  grantUser: boolean;
};
export type AccessCommand = {
  id: string;
  enabled: boolean;
  workflowEnabled: boolean;
  featureIds: readonly string[];
};
/** Trùng `AccessInput` Admin (cùng tên trường, cùng nghĩa). */
export type CommandAccessInput = {
  user: AccessUser;
  betaGroupId: string | null;
  features: readonly AccessFeature[];
  commands: readonly AccessCommand[];
};

export type UsableCommand = { commandId: string; featureId: string };

/** = `commands[].visible` Admin; `featureId` = feature hiệu lực có `key` nhỏ nhất (Q4). */
export function usableCommands(i: CommandAccessInput): UsableCommand[] {
  if (!userUsable(i.user)) return [];
  const groups = new Set(i.user.groupIds);
  const isBeta = i.betaGroupId !== null && groups.has(i.betaGroupId);
  // Như Admin `byId`: id trùng → bản sau thắng; `order` = vị trí trong `features` (phá hoà khi trùng key).
  const byId = new Map<string, Ranked>();
  i.features.forEach((f, order) => {
    byId.set(f.id, { f, order, ok: featureEffective(f, groups, isBeta) });
  });
  const out: UsableCommand[] = [];
  for (const c of i.commands) {
    if (!c.enabled || !c.workflowEnabled) continue;
    const best = pickFeature(c.featureIds, byId);
    if (best) out.push({ commandId: c.id, featureId: best.f.id });
  }
  return out;
}

/** Admin `blockersOf` rỗng: user hoạt động, tenant hoạt động, không bị tenant khoá. */
function userUsable(u: AccessUser): boolean {
  return u.active && u.tenantActive && !u.lockedByTenant;
}

/** Admin `featureOnlyMissing` rỗng (M3-R11): `core` bỏ qua entitlement + grant, vẫn xét `off`/`beta`. */
function featureEffective(f: AccessFeature, groups: ReadonlySet<string>, isBeta: boolean): boolean {
  if (f.status === "off") return false;
  if (f.status === "beta" && !isBeta) return false;
  if (f.key === CORE_FEATURE_KEY) return true;
  return f.entitled && (f.grantUser || f.grantGroupIds.some((g) => groups.has(g)));
}

type Ranked = { f: AccessFeature; order: number; ok: boolean };

/** Feature hiệu lực có `key` nhỏ nhất (so chuỗi như Admin `via` + sort); trùng key → đứng trước trong `features`. */
function pickFeature(ids: readonly string[], byId: ReadonlyMap<string, Ranked>): Ranked | null {
  let best: Ranked | null = null;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r?.ok) continue;
    const better =
      best === null || r.f.key < best.f.key || (r.f.key === best.f.key && r.order < best.order);
    if (better) best = r;
  }
  return best;
}
