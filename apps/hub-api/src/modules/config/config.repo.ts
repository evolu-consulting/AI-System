// HUB-FR-02, HUB-FR-03 · đọc cấu hình `admin` + `hub` cho cache (role hub_api, chỉ SELECT; plan H1 §4 Cache, §3.1, §3.4).
// Bảng cấu hình không RLS, toàn hệ thống (không lọc tenant); `admin.users` chỉ đọc cột hub_ro được GRANT.
import { agentGrants, configMeta, groupMembers, tenants, users } from "@ai/db";
import {
  agentEntitlements,
  agents,
  hubConfigMeta,
  modelProfiles,
  orchestratorSettings,
  providers,
} from "@ai/db/schema/hub";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../lib/db";
import type { ConfigSnapshot, TenantState, UserState } from "./config.rules";

// jsonb validate ở biên (CONVENTIONS §5).
const StepsSchema = z
  .array(
    z.object({
      provider_key: z.string().min(1),
      model: z.string().nullable(),
      on: z.array(z.string()),
    }),
  )
  .min(1);
const NameSchema = z.object({ vi: z.string(), en: z.string() });
const OptionsSchema = z.record(z.string(), z.unknown());

export type Versions = { admin: number; hub: number };

/** Hai số phiên bản cho vòng poll (`HUB_CONFIG_POLL_S`). */
export async function readVersions(db: Db): Promise<Versions> {
  const [a] = await db.db
    .select({ v: configMeta.configVersion })
    .from(configMeta)
    .where(eq(configMeta.id, 1));
  const [h] = await db.db
    .select({ v: hubConfigMeta.hubConfigVersion })
    .from(hubConfigMeta)
    .where(eq(hubConfigMeta.id, 1));
  return { admin: a?.v ?? 0, hub: h?.v ?? 0 };
}

/** Ảnh Hub đọc trong một transaction REPEATABLE READ: `version` khớp đúng dữ liệu đi kèm. */
export function loadHubSnapshot(db: Db): Promise<ConfigSnapshot> {
  return db.db.transaction(
    async (tx) => {
      const [meta] = await tx
        .select({ v: hubConfigMeta.hubConfigVersion })
        .from(hubConfigMeta)
        .where(eq(hubConfigMeta.id, 1));
      const prov = await tx.select().from(providers).orderBy(providers.key);
      const prof = await tx.select().from(modelProfiles).orderBy(modelProfiles.key);
      const ag = await tx.select().from(agents).orderBy(agents.key);
      const [orch] = await tx
        .select()
        .from(orchestratorSettings)
        .where(eq(orchestratorSettings.id, 1));
      const ent = await tx.select().from(agentEntitlements);
      const gr = await tx.select().from(agentGrants);
      return Object.freeze({
        version: meta?.v ?? 0,
        providers: prov.map((p) => ({
          key: p.key,
          kind: p.kind,
          vendor: p.vendor,
          maxConcurrency: p.maxConcurrency,
          enabled: p.enabled,
          devOnly: p.devOnly,
        })),
        profiles: prof.map((p) => ({ id: p.id, key: p.key, steps: StepsSchema.parse(p.steps) })),
        agents: ag.map((a) => ({
          id: a.id,
          key: a.key,
          name: NameSchema.parse(a.name),
          description: a.description,
          runtime: a.runtime,
          agentTypeKey: a.agentTypeKey,
          profileId: a.profileId,
          systemPrompt: a.systemPrompt,
          runtimeOptions: OptionsSchema.parse(a.runtimeOptions),
          timeoutS: a.timeoutS,
          tokenBudget: a.tokenBudget,
          enabled: a.enabled,
          version: a.version,
        })),
        orchestrator: orch
          ? {
              agentId: orch.agentId,
              maxSteps: orch.maxSteps,
              tokenBudget: orch.tokenBudget,
              historyN: orch.historyN,
              onNoMatch: orch.onNoMatch,
              version: orch.version,
            }
          : null,
        entitlements: ent.map((e) => ({
          agentId: e.agentId,
          tenantId: e.tenantId,
          revokedAt: e.revokedAt,
        })),
        grants: gr.map((g) => ({ agentId: g.agentId, tenantId: g.tenantId, subject: g.subjectId })),
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function loadTenants(db: Db): Promise<TenantState[]> {
  return db.db
    .select({ id: tenants.id, active: tenants.active, maxConcurrentSub: tenants.maxConcurrentSub })
    .from(tenants);
}

/** User theo id (kèm nhóm). Rỗng `ids` → []. Id không tồn tại → không có trong kết quả. */
export async function loadUsers(db: Db, ids: readonly string[]): Promise<UserState[]> {
  if (ids.length === 0) return [];
  const rows = await db.db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      active: users.active,
      lockedByTenant: users.lockedByTenant,
      locale: users.locale,
    })
    .from(users)
    .where(inArray(users.id, [...ids]));
  const members = await db.db
    .select({
      userId: groupMembers.userId,
      groupId: groupMembers.groupId,
      tenantId: groupMembers.tenantId,
    })
    .from(groupMembers)
    .where(inArray(groupMembers.userId, [...ids]));
  return rows.map((u) => ({
    ...u,
    groupIds: new Set(
      members.filter((m) => m.userId === u.id && m.tenantId === u.tenantId).map((m) => m.groupId),
    ),
  }));
}
