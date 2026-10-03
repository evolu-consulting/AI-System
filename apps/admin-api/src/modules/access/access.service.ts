// ADM-FR-36, ADM-BR-11, ADM-BR-12, ADM-FR-24 · Kiểm tra quyền (spec M3 §3, M3-R11, R12, R14; plan §5.6). Đọc dữ liệu →
// `computeEffectiveAccess` (hàm thuần) → map sang contract. Không ghi, không khoá.
import {
  ACCESS_COMMANDS_MAX,
  ACCESS_GROUPS_MAX,
  BETA_GROUP_KEY,
  COMMAND_DESC_MAX,
  CORE_FEATURE_KEY,
  type EffectiveAccess,
  type EffectiveAccessQuery,
  FEATURE_NAME_MAX,
  type FeatureMini,
  GROUP_NAME_MAX,
  type GroupRef,
  LocalizedTextSchema,
  USER_GROUPS_MAX,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import { appError } from "../../lib/errors";
import { type Actor, canSeeUser } from "../users/users.rules";
import * as repo from "./access.repo";
import { type CommandAccess, computeEffectiveAccess, type FeatureReason } from "./access.rules";

export type AccessCtx = { db: Db };
export type Call = { ctx: AccessCtx; actor: Actor; scope: DbScope };

const FeatureName = LocalizedTextSchema(FEATURE_NAME_MAX);
const GroupName = LocalizedTextSchema(GROUP_NAME_MAX);
const CommandDesc = LocalizedTextSchema(COMMAND_DESC_MAX);

const toRef = (g: repo.GroupLite): GroupRef => ({
  id: g.id,
  key: g.key,
  name: GroupName.parse(g.name),
  is_beta: g.key === BETA_GROUP_KEY,
});

type Maps = { groups: Map<string, GroupRef>; features: Map<string, FeatureMini> };

function reasonOut(
  r: FeatureReason,
  m: Maps,
): EffectiveAccess["features"][number]["reasons"][number] {
  if (r.code !== "grant_group") return { code: r.code };
  return { code: "grant_group", group: m.groups.get(r.groupId) as GroupRef };
}

function commandOut(
  c: repo.CommandLite,
  a: CommandAccess,
  m: Maps,
): EffectiveAccess["commands"][number] {
  const mini = (id: string) => m.features.get(id) as FeatureMini;
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    description: CommandDesc.parse(c.description),
    visible: a.visible,
    via: a.via.map((v) => ({
      feature: mini(v.featureId),
      reasons: v.reasons.map((r) => reasonOut(r, m)),
    })),
    blocked_by: a.blockedBy.map((b) => ({ feature: mini(b.featureId), missing: b.missing })),
    missing: a.missing,
    suggestion: a.suggestFeatureId
      ? { action: "grant_feature", feature: mini(a.suggestFeatureId) }
      : null,
  };
}

type Loaded = {
  head: repo.UserHead;
  groups: repo.GroupLite[];
  features: repo.FeatureLite[];
  commands: repo.CommandLite[];
};

async function load(tx: Tx, c: Call, userId: string, q: EffectiveAccessQuery): Promise<Loaded> {
  const head = await repo.userHead(
    tx,
    c.actor.role === "platform_admin" ? null : c.actor.tenantId,
    userId,
  );
  if (!head || !canSeeUser(c.actor, { tenantId: head.tenant_id })) throw appError("NOT_FOUND");
  return {
    head,
    groups: await repo.userGroups(tx, head),
    features: await repo.featuresFor(tx, head),
    commands: await repo.commandsFor(tx, { command: q.command, limit: ACCESS_COMMANDS_MAX }),
  };
}

function compute(l: Loaded) {
  return computeEffectiveAccess({
    user: {
      id: l.head.id,
      active: l.head.active,
      lockedByTenant: l.head.locked_by_tenant,
      tenantActive: l.head.tenant_active,
      groupIds: l.groups.map((g) => g.id),
    },
    betaGroupId: l.head.beta_group_id,
    features: l.features.map((f) => ({
      id: f.id,
      key: f.key,
      status: f.status,
      entitled: f.entitled,
      grantGroupIds: f.grant_group_ids,
      grantUser: f.grant_user,
    })),
    commands: l.commands.map((c) => ({
      id: c.id,
      enabled: c.enabled,
      workflowEnabled: c.workflow_enabled,
      featureIds: c.feature_ids,
    })),
  });
}

/** `GET /admin/users/:id/effective-access`: tenant_admin chỉ user tenant mình (khác → 404). */
export function effectiveAccess(
  c: Call,
  userId: string,
  q: EffectiveAccessQuery,
): Promise<EffectiveAccess> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const l = await load(tx, c, userId, q);
    const r = compute(l);
    const refs = l.groups.map(toRef);
    const features = l.features.map((f) => ({
      feature: {
        id: f.id,
        key: f.key,
        name: FeatureName.parse(f.name),
        status: f.status,
        is_core: f.key === CORE_FEATURE_KEY,
      },
    }));
    const m: Maps = {
      groups: new Map(refs.map((g) => [g.id, g])),
      features: new Map(
        features.map(({ feature: f }) => [f.id, { id: f.id, key: f.key, name: f.name }]),
      ),
    };
    return {
      user: {
        id: l.head.id,
        username: l.head.username,
        display_name: l.head.display_name,
        tenant_id: l.head.tenant_id,
        tenant_key: l.head.tenant_key,
        status: l.head.active && !l.head.locked_by_tenant ? "active" : "locked",
        groups: refs.slice(0, USER_GROUPS_MAX),
      },
      blockers: r.blockers,
      features: r.features.map((fa, i) => ({
        feature: (features[i] as (typeof features)[number]).feature,
        effective: fa.effective,
        reasons: fa.reasons.map((x) => reasonOut(x, m)),
        missing: fa.missing,
      })),
      commands: l.commands.map((cmd, i) => commandOut(cmd, r.commands[i] as CommandAccess, m)),
      command_total: l.commands[0]?.total ?? 0,
      agents: { available: false },
      config_version: l.head.config_version,
    };
  });
}

export type TenantExtras = {
  groups: (GroupRef & { feature: FeatureMini })[];
  group_count: number;
  visible_user_count: number;
};

/** Cho commands (`commands/:id/access`, M3-R14): cặp group–feature (≤ 20) + số user thấy thật, theo tenant. */
export async function commandTenantExtras(
  tx: Tx,
  commandId: string,
  tenantIds: readonly string[],
): Promise<Map<string, TenantExtras>> {
  const counts = await repo.visibleUserCounts(tx, commandId, tenantIds);
  const pairs = await repo.groupPairs(tx, commandId, { tenantIds, max: ACCESS_GROUPS_MAX });
  const out = new Map<string, TenantExtras>(
    tenantIds.map((t) => [
      t,
      { groups: [], group_count: 0, visible_user_count: counts.get(t) ?? 0 },
    ]),
  );
  for (const p of pairs) {
    const e = out.get(p.tenant_id) as TenantExtras;
    e.group_count = p.total;
    const feature = { id: p.f_id, key: p.f_key, name: FeatureName.parse(p.f_name) };
    e.groups.push({ ...toRef({ id: p.g_id, key: p.g_key, name: p.g_name }), feature });
  }
  return out;
}
