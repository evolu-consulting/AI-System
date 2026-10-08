// HUB-FR-78 · ADM-FR-37 · H3b-R03, R04, R06, R07, R11 · SQL `/agent-grants` (plan-db H3b §2, nguyên văn).
// `agent_grants` KHÔNG có RLS: cách ly tenant chỉ bằng `tenant_id = T` ở MỌI câu dưới đây (T là tham số đầu, đã chốt
// một lần bằng `targetTenant`). Ngoại lệ có lý do (N5/QP2): `actorName` và join `gb` của `listGrants` — actor có thể là
// platform_admin (tenant khác), chỉ lấy `username`. Scope/transaction do service mở.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type GrantKey = {
  agentId: string;
  subjectType: "group" | "user" | "tenant";
  subjectId: string;
};
export type AgentName = { vi: string; en: string };
export type AgentCheckRow = {
  id: string;
  key: string;
  name: AgentName;
  isOrchestrator: boolean;
  entitled: boolean;
};
export type SubjectRow =
  | { type: "group"; id: string; key: string; name: { vi: string; en?: string } }
  | { type: "user"; id: string; username: string; displayName: string }
  | { type: "tenant"; id: string };
export type StoredGrant = { id: string; grantedBy: string | null; grantedAt: string };

const iso = (v: Date | string): string => new Date(v).toISOString();

/** TENANT_EXISTS — chỉ gọi khi platform_admin (tenant đích đến từ query). */
export async function tenantExists(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from admin.tenants where id = ${tenantId}`);
  return rows.length > 0;
}

/** AGENT_CHECK — agent (catalog platform) + Orchestrator mọi phạm vi + entitlement chưa thu hồi CỦA T. */
export async function agentCheck(
  tx: Tx,
  tenantId: string,
  agentId: string,
): Promise<AgentCheckRow | null> {
  const [r] = await tx.execute<{
    id: string;
    key: string;
    name: AgentName;
    is_orch: boolean;
    entitled: boolean;
  }>(sql`select a.id, a.key, a.name,
      exists (select 1 from hub.orchestrator_settings o where o.agent_id = a.id) as is_orch,
      (e.agent_id is not null and e.revoked_at is null) as entitled
    from hub.agents a
    left join hub.agent_entitlements e on e.agent_id = a.id and e.tenant_id = ${tenantId}
    where a.id = ${agentId}`);
  if (!r) return null;
  return { id: r.id, key: r.key, name: r.name, isOrchestrator: r.is_orch, entitled: r.entitled };
}

/** SUBJECT_GROUP / SUBJECT_USER — subject phải thuộc T; tenant khác ≡ không có (không lộ tồn tại). */
export async function findSubject(
  tx: Tx,
  tenantId: string,
  type: "group" | "user" | "tenant",
  id: string,
): Promise<SubjectRow | null> {
  // CR-054: "cả công ty" — subject_id phải đúng tenant đích.
  if (type === "tenant") return id === tenantId ? { type, id } : null;
  if (type === "group") {
    const [g] = await tx.execute<{ id: string; key: string; name: { vi: string; en?: string } }>(
      sql`select id, key, name from admin.groups where id = ${id} and tenant_id = ${tenantId}`,
    );
    return g ? { type, id: g.id, key: g.key, name: g.name } : null;
  }
  const [u] = await tx.execute<{ id: string; username: string; display_name: string }>(
    sql`select id, username, display_name from admin.users where id = ${id} and tenant_id = ${tenantId}`,
  );
  return u ? { type, id: u.id, username: u.username, displayName: u.display_name } : null;
}

/** ACTOR_NAME — cố ý KHÔNG lọc tenant (N5/QP2): actor platform_admin ở tenant khác; chỉ đọc `username`. */
export async function actorName(tx: Tx, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const [r] = await tx.execute<{ username: string }>(
    sql`select username from admin.users where id = ${userId}`,
  );
  return r?.username ?? null;
}

/** INSERT_GRANT — trùng khoá ⇒ null (tập hợp, R06). Gọi SAU `lockHubConfig` (thứ tự khoá plan §6). */
export async function insertGrant(
  tx: Tx,
  tenantId: string,
  k: GrantKey,
  grantedBy: string,
): Promise<{ id: string; grantedAt: string } | null> {
  const [r] = await tx.execute<{ id: string; granted_at: Date | string }>(
    sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id, granted_by)
      values (${k.agentId}, ${tenantId}, ${k.subjectType}, ${k.subjectId}, ${grantedBy})
      on conflict (agent_id, tenant_id, subject_type, subject_id) do nothing
      returning id, granted_at`,
  );
  return r ? { id: r.id, grantedAt: iso(r.granted_at) } : null;
}

type GrantDbRow = { id: string; granted_by: string | null; granted_at: Date | string };
const toStored = (r: GrantDbRow): StoredGrant => ({
  id: r.id,
  grantedBy: r.granted_by,
  grantedAt: iso(r.granted_at),
});

/** FIND_GRANT — hàng gốc khi POST trùng (G13: granted_by/granted_at của hàng có sẵn). */
export async function findGrant(
  tx: Tx,
  tenantId: string,
  k: GrantKey,
): Promise<StoredGrant | null> {
  const [r] =
    await tx.execute<GrantDbRow>(sql`select id, granted_by, granted_at from hub.agent_grants
    where tenant_id = ${tenantId} and agent_id = ${k.agentId} and subject_type = ${k.subjectType}
      and subject_id = ${k.subjectId}`);
  return r ? toStored(r) : null;
}

/** DELETE_GRANT — chỉ hàng của T; hàng tenant khác ≡ không có (R07). */
export async function deleteGrant(
  tx: Tx,
  tenantId: string,
  k: GrantKey,
): Promise<StoredGrant | null> {
  const [r] = await tx.execute<GrantDbRow>(sql`delete from hub.agent_grants
    where tenant_id = ${tenantId} and agent_id = ${k.agentId} and subject_type = ${k.subjectType}
      and subject_id = ${k.subjectId}
    returning id, granted_by, granted_at`);
  return r ? toStored(r) : null;
}

/** Version hiện tại (đọc, không khoá) — danh sách trả kèm (R11). `config_meta` một hàng toàn cục, không tenant. */
export async function currentVersion(tx: Tx): Promise<number> {
  const [r] = await tx.execute<{ v: number }>(
    sql`select hub_config_version as v from hub.config_meta where id = 1`,
  );
  return Number(r?.v ?? 0);
}

export type ListAgentRow = {
  id: string;
  key: string;
  name: AgentName;
  description: string;
  enabled: boolean;
  runtime: string;
};

/** LIST_AGENTS — entitlement chưa thu hồi của T, trừ Orchestrator, sắp key; `limit` = max + 1 để biết `truncated`. */
export function listAgents(tx: Tx, tenantId: string, limit: number): Promise<ListAgentRow[]> {
  return tx.execute<ListAgentRow>(sql`select a.id, a.key, a.name, a.description, a.enabled, a.runtime
    from hub.agent_entitlements e join hub.agents a on a.id = e.agent_id
    where e.tenant_id = ${tenantId} and e.revoked_at is null
      and not exists (select 1 from hub.orchestrator_settings o where o.agent_id = a.id)
    order by a.key limit ${limit}`);
}

export type ListGrantRow = {
  id: string;
  agent_id: string;
  subject_type: "group" | "user" | "tenant";
  subject_id: string;
  granted_at: Date | string;
  granted_by: string | null;
  group_key: string | null;
  group_name: { vi: string; en?: string } | null;
  username: string | null;
  display_name: string | null;
};

/** LIST_GRANTS — grant của T trên các agent đã chọn; group/user join cùng T (bỏ grant mồ côi, Q-K8); `gb` không lọc tenant (N5). */
export function listGrants(
  tx: Tx,
  tenantId: string,
  agentIds: readonly string[],
  subject: { type: "group" | "user" | "tenant"; id: string } | null,
): Promise<ListGrantRow[]> {
  const ids = `{${agentIds.join(",")}}`;
  return tx.execute<ListGrantRow>(sql`select g.id, g.agent_id, g.subject_type, g.subject_id, g.granted_at,
      gb.username as granted_by, gr.key as group_key, gr.name as group_name, u.username, u.display_name
    from hub.agent_grants g
    left join admin.groups gr on g.subject_type = 'group' and gr.id = g.subject_id and gr.tenant_id = ${tenantId}
    left join admin.users u on g.subject_type = 'user' and u.id = g.subject_id and u.tenant_id = ${tenantId}
    left join admin.users gb on gb.id = g.granted_by
    where g.tenant_id = ${tenantId} and g.agent_id = any(${ids}::uuid[])
      and (${subject?.type ?? null}::text is null
        or (g.subject_type = ${subject?.type ?? null}::text and g.subject_id = ${subject?.id ?? null}::uuid))
      and (gr.id is not null or u.id is not null or (g.subject_type = 'tenant' and g.subject_id = ${tenantId}))
    order by g.agent_id, case g.subject_type when 'tenant' then 0 when 'group' then 1 else 2 end,
      coalesce(gr.key, u.username)`);
}

export type GroupRefRow = { id: string; key: string; name: { vi: string; en?: string } };

/** GROUP_REFS (plan-db §4) — tên group cho `reasons` của effective; chỉ group của T (PK). Group đã xoá ⇒ không có hàng. */
export function groupRefs(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<GroupRefRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.execute<GroupRefRow>(sql`select id, key, name from admin.groups
    where tenant_id = ${tenantId} and id = any(${`{${ids.join(",")}}`}::uuid[])`);
}
