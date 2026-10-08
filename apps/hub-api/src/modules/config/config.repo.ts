// HUB-FR-02, HUB-FR-03 · đọc cấu hình `admin` + `hub` cho cache (role hub_api, chỉ SELECT; plan H1 §4 Cache, §3.1, §3.4).
// Bảng cấu hình không RLS, toàn hệ thống (không lọc tenant); `admin.users` chỉ đọc cột hub_ro được GRANT.
import { agentGrants, agentWorkflows, configMeta, groupMembers, tenants, users } from "@ai/db";
import {
  agentEntitlements,
  agents,
  hubConfigMeta,
  modelProfiles,
  orchestratorSettings,
  providers,
  tenantAgentDefaults,
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

type AgentRow = typeof agents.$inferSelect;
type OrchRow = typeof orchestratorSettings.$inferSelect;

const toAgent = (a: AgentRow): ConfigSnapshot["agents"][number] => ({
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
  model: a.model,
});

type OrchestratorConfig = NonNullable<ConfigSnapshot["orchestrator"]>;

const toOrchestrator = (o: OrchRow): OrchestratorConfig => ({
  agentId: o.agentId,
  maxSteps: o.maxSteps,
  tokenBudget: o.tokenBudget,
  historyN: o.historyN,
  onNoMatch: o.onNoMatch,
  version: o.version,
});

/**
 * H2b P6: mọi hàng `orchestrator_settings` → mặc định (`id=1`, `tenant_id` NULL) + bản theo tenant (khoá `tenant_id`).
 * CHECK `(id = 1) = (tenant_id IS NULL)` bảo đảm hai nhóm không chồng nhau.
 */
export function splitOrchestratorRows(
  rows: readonly OrchRow[],
): Pick<ConfigSnapshot, "orchestrator" | "orchestratorTenants"> {
  const def = rows.find((o) => o.tenantId === null);
  const tenants = new Map<string, OrchestratorConfig>();
  for (const o of rows) if (o.tenantId !== null) tenants.set(o.tenantId, toOrchestrator(o));
  return { orchestrator: def ? toOrchestrator(def) : null, orchestratorTenants: tenants };
}

type Tx = Parameters<Parameters<Db["db"]["transaction"]>[0]>[0];

async function readHubRows(tx: Tx) {
  const [meta] = await tx
    .select({ v: hubConfigMeta.hubConfigVersion })
    .from(hubConfigMeta)
    .where(eq(hubConfigMeta.id, 1));
  const orch = await tx.select().from(orchestratorSettings).orderBy(orchestratorSettings.id);
  return {
    version: meta?.v ?? 0,
    prov: await tx.select().from(providers).orderBy(providers.key),
    prof: await tx.select().from(modelProfiles).orderBy(modelProfiles.key),
    ag: await tx.select().from(agents).orderBy(agents.key),
    orch,
    ent: await tx.select().from(agentEntitlements),
    gr: await tx.select().from(agentGrants),
    td: await tx.select().from(tenantAgentDefaults),
    aw: await tx
      .select({ agentId: agentWorkflows.agentId, workflowId: agentWorkflows.workflowId })
      .from(agentWorkflows),
  };
}

function groupAgentWorkflows(
  rows: readonly { agentId: string; workflowId: string }[],
): ConfigSnapshot["agentWorkflows"] {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = m.get(r.agentId) ?? new Set<string>();
    set.add(r.workflowId);
    m.set(r.agentId, set);
  }
  return m;
}

/** Ảnh Hub đọc trong một transaction REPEATABLE READ: `version` khớp đúng dữ liệu đi kèm. */
export function loadHubSnapshot(db: Db): Promise<ConfigSnapshot> {
  return db.db.transaction(
    async (tx) => {
      const r = await readHubRows(tx);
      return Object.freeze({
        version: r.version,
        providers: r.prov.map((p) => ({
          key: p.key,
          kind: p.kind,
          vendor: p.vendor,
          maxConcurrency: p.maxConcurrency,
          enabled: p.enabled,
          devOnly: p.devOnly,
        })),
        profiles: r.prof.map((p) => ({ id: p.id, key: p.key, steps: StepsSchema.parse(p.steps) })),
        agents: r.ag.map(toAgent),
        ...splitOrchestratorRows(r.orch),
        entitlements: r.ent.map((e) => ({
          agentId: e.agentId,
          tenantId: e.tenantId,
          revokedAt: e.revokedAt,
        })),
        grants: r.gr.map((g) => ({
          agentId: g.agentId,
          tenantId: g.tenantId,
          subject: g.subjectId,
        })),
        agentWorkflows: groupAgentWorkflows(r.aw),
        tenantDefaults: new Map(
          r.td.map((d) => [
            d.tenantId,
            {
              defaultAgentId: d.defaultAgentId,
              fallbackAgentId: d.fallbackAgentId,
              onNoMatch: d.onNoMatch,
            },
          ]),
        ),
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
