// HUB-FR-77 · CR-054 · truy vấn `/agent-settings`: agent (catalog platform) + entitlement của T + Orchestrator mọi phạm vi
// + model đang dùng (agent.model ?? bước 0 profile, tên từ `hub.provider_models`), agent mặc định của T. Ghi SAU
// `lockHubConfig` (thứ tự khoá như `/agent-grants`).
import type { AgentDefaults } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type SettingsAgentRow = {
  id: string;
  key: string;
  name: { vi: string; en: string };
  description: string;
  runtime: string;
  enabled: boolean;
  entitled: boolean;
  is_orch: boolean;
  model: string | null;
  model_name: string | null;
};

/** Tối đa = `AgentSettingsResponseSchema.agents`. */
export const SETTINGS_AGENTS_MAX = 200;

/**
 * Agent của T (sắp `key`): platform_admin ⇒ catalog platform (để bật cho công ty); tenant_admin ⇒ chỉ agent đã bật cho T
 * (H3b-R13 · không lộ catalog). Orchestrator: chỉ bản chạy cho T (bản riêng của T, vắng ⇒ bản chung — như
 * `pickOrchestrator`); Orchestrator riêng của tenant khác không bao giờ trả. `model` = riêng của agent ?? bước 0 profile.
 */
export function listAgents(
  tx: Tx,
  tenantId: string,
  scope: "catalog" | "entitled",
): Promise<SettingsAgentRow[]> {
  return tx.execute<SettingsAgentRow>(sql`
    with m as (
      select a.id, coalesce(a.model, p.steps -> 0 ->> 'model') as model,
        p.steps -> 0 ->> 'provider_key' as provider_key
      from hub.agents a left join hub.model_profiles p on p.id = a.profile_id)
    select a.id, a.key, a.name, a.description, a.runtime, a.enabled,
      (e.agent_id is not null and e.revoked_at is null) as entitled,
      exists (select 1 from hub.orchestrator_settings o where o.agent_id = a.id) as is_orch,
      m.model,
      (select pm.display_name from hub.provider_models pm where pm.value = m.model and pm.provider_key = m.provider_key
        order by pm.position limit 1) as model_name
    from hub.agents a
    join m on m.id = a.id
    left join hub.agent_entitlements e on e.agent_id = a.id and e.tenant_id = ${tenantId}
    where not exists (select 1 from hub.orchestrator_settings o where o.agent_id = a.id
        and o.id is distinct from (select r.id from hub.orchestrator_settings r
          where r.tenant_id = ${tenantId} or r.tenant_id is null
          order by r.tenant_id nulls last limit 1))
      and (${scope} = 'catalog' or (e.agent_id is not null and e.revoked_at is null))
    order by a.key limit ${SETTINGS_AGENTS_MAX}`);
}

type DefaultsRow = {
  default_agent_id: string;
  fallback_agent_id: string | null;
  on_no_match: string;
};

export async function readDefaults(tx: Tx, tenantId: string): Promise<AgentDefaults | null> {
  const [r] =
    await tx.execute<DefaultsRow>(sql`select default_agent_id, fallback_agent_id, on_no_match
    from hub.tenant_agent_defaults where tenant_id = ${tenantId}`);
  if (!r) return null;
  return {
    default_agent_id: r.default_agent_id,
    fallback_agent_id: r.fallback_agent_id,
    on_no_match: r.on_no_match as AgentDefaults["on_no_match"],
  };
}

/** Ghi đè cấu hình mặc định của T; trả true khi có đổi (giống ⇒ không bump). */
export async function upsertDefaults(
  tx: Tx,
  tenantId: string,
  d: AgentDefaults,
  by: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    insert into hub.tenant_agent_defaults as t (tenant_id, default_agent_id, fallback_agent_id, on_no_match, updated_by)
    values (${tenantId}, ${d.default_agent_id}, ${d.fallback_agent_id}, ${d.on_no_match}, ${by})
    on conflict (tenant_id) do update set default_agent_id = excluded.default_agent_id,
      fallback_agent_id = excluded.fallback_agent_id, on_no_match = excluded.on_no_match,
      updated_by = excluded.updated_by, updated_at = now()
    where (t.default_agent_id, t.fallback_agent_id, t.on_no_match)
      is distinct from (excluded.default_agent_id, excluded.fallback_agent_id, excluded.on_no_match)
    returning 1`);
  return rows.length > 0;
}

/** Bật (tạo/khôi phục) hoặc tắt (thu hồi) entitlement; trả true khi có đổi. */
export type EntitlementChange = {
  tenantId: string;
  agentId: string;
  entitled: boolean;
  by: string;
};

export async function setEntitlement(
  tx: Tx,
  { tenantId, agentId, entitled, by }: EntitlementChange,
): Promise<boolean> {
  const rows = entitled
    ? await tx.execute(sql`
        insert into hub.agent_entitlements as e (agent_id, tenant_id, granted_by)
        values (${agentId}, ${tenantId}, ${by})
        on conflict (agent_id, tenant_id) do update set revoked_at = null, granted_by = excluded.granted_by,
          granted_at = now()
        where e.revoked_at is not null
        returning 1`)
    : await tx.execute(sql`
        update hub.agent_entitlements set revoked_at = now()
        where agent_id = ${agentId} and tenant_id = ${tenantId} and revoked_at is null
        returning 1`);
  return rows.length > 0;
}

/** Version cấu hình Hub hiện tại (đọc, không khoá). */
export async function configVersion(tx: Tx): Promise<number> {
  const [r] = await tx.execute<{ v: number }>(
    sql`select hub_config_version as v from hub.config_meta where id = 1`,
  );
  return Number(r?.v ?? 0);
}

/** Tenant đích tồn tại — chỉ gọi khi platform_admin (như `/agent-grants`; repo không dùng chéo module). */
export async function tenantExists(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from admin.tenants where id = ${tenantId}`);
  return rows.length > 0;
}

/** Username người thao tác (audit). */
export async function actorName(tx: Tx, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const [r] = await tx.execute<{ username: string }>(
    sql`select username from admin.users where id = ${userId}`,
  );
  return r?.username ?? null;
}
