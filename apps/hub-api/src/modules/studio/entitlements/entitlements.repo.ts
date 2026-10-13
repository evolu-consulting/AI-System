// HUB-FR-77 · HUB-FR-78 · spec H4b2 §3 C · plan §3.5 · câu SQL đọc Quyền agent (Studio). Transaction + scope do service mở
// (đọc: scope `system`, REPEATABLE READ read only). Ghi KHÔNG ở đây — đi qua `AgentSettingsService.putEntitlement` (D2).
// Index: PK `agent_entitlements` · `agent_grants_uq (agent_id, tenant_id, …)` · `agents`/`admin.tenants` quét ≤ 201 hàng
// (spec-decisions §Index).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type MatrixAgentRow = {
  id: string;
  key: string;
  name: { vi: string; en?: string };
  enabled: boolean;
  is_orch: boolean;
  only_tenant_id: string | null;
};

/**
 * Mọi agent (cả đang tắt) sắp `key`, lấy `limit + 1` để biết `truncated`. `only_tenant_id` = tenant của Orchestrator
 * riêng; agent có hàng `orchestrator_settings` chung (`tenant_id` null) ⇒ null (`nulls first`).
 */
export function readMatrixAgents(tx: Tx, limit: number): Promise<MatrixAgentRow[]> {
  return tx.execute<MatrixAgentRow>(sql`select a.id, a.key, a.name, a.enabled,
      exists (select 1 from hub.orchestrator_settings o where o.agent_id = a.id) as is_orch,
      (select o.tenant_id from hub.orchestrator_settings o where o.agent_id = a.id
        order by o.tenant_id nulls first limit 1) as only_tenant_id
    from hub.agents a order by a.key limit ${limit + 1}`);
}

export type MatrixTenantRow = { id: string; key: string; name: string; active: boolean };

export function readMatrixTenants(tx: Tx, limit: number): Promise<MatrixTenantRow[]> {
  return tx.execute<MatrixTenantRow>(sql`select id, key, name, active from admin.tenants
    order by key limit ${limit + 1}`);
}

export type EntRow = { agent_id: string; tenant_id: string; granted_at: Date | string };

/** Entitlement CHƯA thu hồi (index `(tenant_id) WHERE revoked_at IS NULL`). */
export function readActiveEntitlements(tx: Tx): Promise<EntRow[]> {
  return tx.execute<EntRow>(sql`select agent_id, tenant_id, granted_at from hub.agent_entitlements
    where revoked_at is null`);
}

export type GrantCountRow = {
  agent_id: string;
  tenant_id: string;
  subject_type: "group" | "user" | "tenant";
  n: number;
};

/** Đếm grant theo (agent, tenant, loại) — mọi grant, khớp `affected_grants`. */
export function readGrantCounts(tx: Tx): Promise<GrantCountRow[]> {
  return tx.execute<GrantCountRow>(sql`select agent_id, tenant_id, subject_type, count(*)::int as n
    from hub.agent_grants group by agent_id, tenant_id, subject_type`);
}

export type CellAgentRow = { id: string; key: string; name: { vi: string; en?: string } };

export async function readAgent(tx: Tx, id: string): Promise<CellAgentRow | undefined> {
  const [r] = await tx.execute<CellAgentRow>(
    sql`select id, key, name from hub.agents where id = ${id}`,
  );
  return r;
}

export type CellTenantRow = { id: string; key: string; name: string };

export async function readTenant(tx: Tx, id: string): Promise<CellTenantRow | undefined> {
  const [r] = await tx.execute<CellTenantRow>(
    sql`select id, key, name from admin.tenants where id = ${id}`,
  );
  return r;
}

export type CellEntRow = {
  granted_at: Date | string;
  revoked_at: Date | string | null;
  granted_by: string | null;
  granted_by_username: string | null;
};

/** Hàng entitlement của ô — kể cả đã thu hồi. */
export async function readCellEntitlement(
  tx: Tx,
  agentId: string,
  tenantId: string,
): Promise<CellEntRow | undefined> {
  const [r] = await tx.execute<CellEntRow>(sql`select e.granted_at, e.revoked_at, e.granted_by,
      u.username as granted_by_username
    from hub.agent_entitlements e left join admin.users u on u.id = e.granted_by
    where e.agent_id = ${agentId} and e.tenant_id = ${tenantId}`);
  return r;
}

export type CellGrantRow = {
  id: string;
  subject_type: "group" | "user" | "tenant";
  subject_id: string;
  granted_at: Date | string;
  granted_by_username: string | null;
  group_name: { vi: string; en?: string } | null;
  user_name: string | null;
  tenant_name: string | null;
};

/** Grant của ô (sắp `granted_at`), `limit + 1`; tên subject join cùng tenant (vắng ⇒ null, map dùng id). */
export function readCellGrants(
  tx: Tx,
  agentId: string,
  tenantId: string,
  limit: number,
): Promise<CellGrantRow[]> {
  return tx.execute<CellGrantRow>(sql`select g.id, g.subject_type, g.subject_id, g.granted_at,
      gb.username as granted_by_username, gr.name as group_name,
      coalesce(u.display_name, u.username) as user_name, t.name as tenant_name
    from hub.agent_grants g
    left join admin.groups gr on g.subject_type = 'group' and gr.id = g.subject_id and gr.tenant_id = ${tenantId}
    left join admin.users u on g.subject_type = 'user' and u.id = g.subject_id and u.tenant_id = ${tenantId}
    left join admin.tenants t on g.subject_type = 'tenant' and t.id = g.subject_id
    left join admin.users gb on gb.id = g.granted_by
    where g.agent_id = ${agentId} and g.tenant_id = ${tenantId}
    order by g.granted_at, g.id limit ${limit + 1}`);
}

/** Số grant của (agent, tenant) — `affected_grants` (PUT/DELETE). */
export async function countCellGrants(tx: Tx, agentId: string, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.agent_grants
    where agent_id = ${agentId} and tenant_id = ${tenantId}`);
  return Number(r?.n ?? 0);
}
