// ADM-FR-36, ADM-BR-11, ADM-BR-12 · hiệu lực quyền dạng hàm thuần (plan M3 §4; M3-R11, R12). Chuẩn tham chiếu cho
// `effective-access` và test chéo với SQL của Hub (plan §3.2). Không import I/O.
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
export type AccessInput = {
  user: AccessUser;
  betaGroupId: string | null;
  features: readonly AccessFeature[];
  commands: readonly AccessCommand[];
};
export type FeatureReason =
  | { code: "core" }
  | { code: "grant_user" }
  | { code: "grant_group"; groupId: string }
  | { code: "beta_member" };
export type UserBlocker = "user_inactive" | "tenant_locked";
export type FeatureOnlyMissing = "feature_off" | "beta_not_member" | "no_entitlement" | "no_grant";
export type FeatureMissing = UserBlocker | FeatureOnlyMissing;
export type CommandMissing =
  | UserBlocker
  | "command_disabled"
  | "workflow_disabled"
  | "no_effective_feature";
export type FeatureAccess = {
  featureId: string;
  effective: boolean;
  reasons: FeatureReason[];
  missing: FeatureMissing[];
};
export type CommandAccess = {
  commandId: string;
  visible: boolean;
  via: { featureId: string; reasons: FeatureReason[] }[];
  blockedBy: { featureId: string; missing: FeatureOnlyMissing[] }[];
  missing: CommandMissing[];
  suggestFeatureId: string | null;
};
export type EffectiveAccess = {
  blockers: UserBlocker[];
  features: FeatureAccess[];
  commands: CommandAccess[];
};

function blockersOf(u: AccessUser): UserBlocker[] {
  const out: UserBlocker[] = [];
  if (!u.active) out.push("user_inactive");
  if (!u.tenantActive || u.lockedByTenant) out.push("tenant_locked");
  return out;
}

function reasonsOf(
  f: AccessFeature,
  groups: ReadonlySet<string>,
  isBeta: boolean,
): FeatureReason[] {
  if (f.key === CORE_FEATURE_KEY) return [{ code: "core" }];
  const out: FeatureReason[] = f.grantUser ? [{ code: "grant_user" }] : [];
  for (const g of f.grantGroupIds) if (groups.has(g)) out.push({ code: "grant_group", groupId: g });
  if (f.status === "beta" && isBeta) out.push({ code: "beta_member" });
  return out;
}

function featureOnlyMissing(
  f: AccessFeature,
  groups: ReadonlySet<string>,
  isBeta: boolean,
): FeatureOnlyMissing[] {
  const core = f.key === CORE_FEATURE_KEY;
  const out: FeatureOnlyMissing[] = [];
  if (f.status === "off") out.push("feature_off");
  if (f.status === "beta" && !isBeta) out.push("beta_not_member");
  if (!core && !f.entitled) out.push("no_entitlement");
  if (!core && !f.grantUser && !f.grantGroupIds.some((g) => groups.has(g))) out.push("no_grant");
  return out;
}

function commandOf(
  c: AccessCommand,
  byId: ReadonlyMap<string, { f: FeatureAccess; only: FeatureOnlyMissing[]; order: number }>,
  blockers: UserBlocker[],
): CommandAccess {
  const mine = c.featureIds
    .map((id) => byId.get(id))
    .filter((x): x is NonNullable<typeof x> => x !== undefined)
    .sort((a, b) => a.order - b.order);
  const via = mine
    .filter((x) => x.f.effective)
    .map((x) => ({ featureId: x.f.featureId, reasons: x.f.reasons }));
  const blocked = mine.filter((x) => !x.f.effective);
  const missing: CommandMissing[] = [...blockers];
  if (!c.enabled) missing.push("command_disabled");
  if (!c.workflowEnabled) missing.push("workflow_disabled");
  if (via.length === 0 && blockers.length === 0) missing.push("no_effective_feature");
  const canSuggest = missing.length > 0 && blockers.length === 0 && c.enabled && c.workflowEnabled;
  const hit = canSuggest
    ? blocked.find((x) => x.only.length === 1 && x.only[0] === "no_grant")
    : undefined;
  return {
    commandId: c.id,
    visible: missing.length === 0,
    via,
    blockedBy: blocked.map((x) => ({ featureId: x.f.featureId, missing: x.only })),
    missing,
    suggestFeatureId: hit?.f.featureId ?? null,
  };
}

/** Luật chính xác: plan M3 §4 (blockers → feature reasons/missing → command via/blockedBy/missing → gợi ý). */
export function computeEffectiveAccess(input: AccessInput): EffectiveAccess {
  const blockers = blockersOf(input.user);
  const groups = new Set(input.user.groupIds);
  const isBeta = input.betaGroupId !== null && groups.has(input.betaGroupId);
  const byId = new Map<string, { f: FeatureAccess; only: FeatureOnlyMissing[]; order: number }>();
  const features = input.features.map((f, order) => {
    const only = featureOnlyMissing(f, groups, isBeta);
    const missing: FeatureMissing[] = [...blockers, ...only];
    const fa = {
      featureId: f.id,
      effective: missing.length === 0,
      reasons: reasonsOf(f, groups, isBeta),
      missing,
    };
    byId.set(f.id, { f: fa, only, order });
    return fa;
  });
  const commands = input.commands.map((c) => commandOf(c, byId, blockers));
  return { blockers, features, commands };
}
