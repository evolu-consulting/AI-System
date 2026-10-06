// HUB-FR-60 · HUB-FR-64 · H4a-R03, R04, R11 · plan §5.2, §8 · câu SQL agent Studio. Transaction + scope `system` do
// service/`withConfigWrite` mở. Bảng cấu hình không RLS (cách ly bằng role — plan §6). jsonb: `JSON.stringify` + `::jsonb`
// (bẫy postgres.js CONVENTIONS §2). Cột tương quan viết tường minh `a.id` (alias), không `${table.col}`.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const iso = (v: Date | string): string => new Date(v).toISOString();
const uuidArr = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

export type AgentDbRow = {
  id: string;
  key: string;
  name: { vi: string; en: string };
  description: string;
  runtime: string;
  agentTypeKey: string | null;
  profileId: string | null;
  systemPrompt: string;
  runtimeOptions: Record<string, unknown>;
  timeoutS: number;
  tokenBudget: number | null;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type RawAgent = Omit<AgentDbRow, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

const AGENT_COLS = sql`a.id, a.key, a.name, a.description, a.runtime, a.agent_type_key as "agentTypeKey",
  a.profile_id as "profileId", a.system_prompt as "systemPrompt", a.runtime_options as "runtimeOptions",
  a.timeout_s as "timeoutS", a.token_budget as "tokenBudget", a.enabled, a.version,
  a.created_at as "createdAt", a.updated_at as "updatedAt"`;

const toRow = (r: RawAgent): AgentDbRow => ({
  ...r,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export async function findAgentByKey(tx: Tx, key: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from hub.agents where key = ${key}`);
  return rows.length > 0;
}

export async function profileExists(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from hub.model_profiles where id = ${id}::uuid`);
  return rows.length > 0;
}

export async function findAgentType(
  tx: Tx,
  key: string,
): Promise<{ runtime: string; available: boolean } | undefined> {
  const [r] = await tx.execute<{ runtime: string; available: boolean }>(
    sql`select runtime, available from hub.agent_types where key = ${key}`,
  );
  return r;
}

export type WorkflowDbRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  appType: string;
  enabled: boolean;
  inputSchema: unknown;
};

/** `admin.workflows` theo id (cả workflow tắt — để báo `disabled` và ghép chi tiết E2). */
export function workflowsByIds(tx: Tx, ids: readonly string[]): Promise<WorkflowDbRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.execute<WorkflowDbRow>(sql`select id, key, name, description, app_type as "appType", enabled,
      input_schema as "inputSchema"
    from admin.workflows where id = any(${uuidArr(ids)}) order by key`);
}

export async function workflowIdByKey(tx: Tx, key: string): Promise<string | undefined> {
  const [r] = await tx.execute<{ id: string }>(
    sql`select id from admin.workflows where key = ${key}`,
  );
  return r?.id;
}

export type AgentInsert = Omit<AgentDbRow, "id" | "version" | "createdAt" | "updatedAt">;

export async function insertAgent(tx: Tx, a: AgentInsert): Promise<AgentDbRow> {
  const [r] =
    await tx.execute<RawAgent>(sql`insert into hub.agents as a (key, name, description, runtime,
      agent_type_key, profile_id, system_prompt, runtime_options, timeout_s, token_budget, enabled)
    values (${a.key}, ${JSON.stringify(a.name)}::jsonb, ${a.description}, ${a.runtime}, ${a.agentTypeKey}::text,
      ${a.profileId}::uuid, ${a.systemPrompt}, ${JSON.stringify(a.runtimeOptions)}::jsonb, ${a.timeoutS}::int,
      ${a.tokenBudget}::int, ${a.enabled}::boolean)
    returning ${AGENT_COLS}`);
  if (!r) throw new Error("insert hub.agents không trả hàng");
  return toRow(r);
}

export async function insertAgentWorkflows(
  tx: Tx,
  agentId: string,
  workflowIds: readonly string[],
  by: string,
): Promise<void> {
  if (workflowIds.length === 0) return;
  await tx.execute(sql`insert into hub.agent_workflows (agent_id, workflow_id, created_by)
    select ${agentId}::uuid, w, ${by}::uuid from unnest(${uuidArr(workflowIds)}) as w
    on conflict do nothing`);
}

export async function readAgent(
  tx: Tx,
  id: string,
  forUpdate = false,
): Promise<AgentDbRow | undefined> {
  const lock = forUpdate ? sql`for update` : sql``;
  const [r] = await tx.execute<RawAgent>(
    sql`select ${AGENT_COLS} from hub.agents a where a.id = ${id}::uuid ${lock}`,
  );
  return r ? toRow(r) : undefined;
}

export async function agentWorkflowIds(tx: Tx, agentId: string): Promise<string[]> {
  const rows = await tx.execute<{
    id: string;
  }>(sql`select workflow_id as id from hub.agent_workflows
    where agent_id = ${agentId}::uuid order by workflow_id`);
  return rows.map((r) => r.id);
}

export type OrchScope = { tenantId: string | null; tenantKey: string | null };

/** Phạm vi agent đang là Orchestrator (mặc định trước, rồi theo key tenant). Tenant mất ⇒ key `""` (contract `string`). */
export function orchScopes(tx: Tx, agentId: string): Promise<OrchScope[]> {
  return tx.execute<OrchScope>(sql`select o.tenant_id as "tenantId", case when o.tenant_id is null then null else coalesce(t.key, '') end as "tenantKey"
    from hub.orchestrator_settings o left join admin.tenants t on t.id = o.tenant_id
    where o.agent_id = ${agentId}::uuid order by o.tenant_id nulls first, t.key`);
}

export type DescRow = { id: string; key: string; description: string; enabled: boolean };

/** Agent bật cho `similarAgents` (R08) — O(n ≤ 5 000). */
export function enabledDescriptions(tx: Tx): Promise<DescRow[]> {
  return tx.execute<DescRow>(
    sql`select id, key, description, enabled from hub.agents where enabled order by key`,
  );
}

export type AgentListFilter = {
  q?: string;
  runtime?: string;
  enabled?: "true" | "false";
  limit: number;
  offset: number;
};

export type AgentListDbRow = {
  id: string;
  key: string;
  name: { vi: string; en: string };
  description: string;
  runtime: string;
  enabled: boolean;
  version: number;
  updatedAt: string;
  profileId: string | null;
  profileKey: string | null;
  workflowCount: number;
  entitledTenantCount: number;
  orchDefault: boolean;
  orchTenants: string[];
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function listWhere(f: AgentListFilter): SQL {
  const conds: SQL[] = [sql`true`];
  if (f.q !== undefined) {
    const p = `%${likeEscape(f.q)}%`;
    conds.push(sql`(a.key ilike ${p} or a.name->>'vi' ilike ${p} or a.name->>'en' ilike ${p})`);
  }
  if (f.runtime !== undefined) conds.push(sql`a.runtime = ${f.runtime}`);
  if (f.enabled !== undefined) conds.push(sql`a.enabled = ${f.enabled === "true"}::boolean`);
  return sql.join(conds, sql` and `);
}

/**
 * R11 · trang list + `total` (cửa sổ). `workflow_count`: dòng `agent_workflows`, agent dify-* seed cũ chưa có dòng thì
 * suy từ `runtime_options.workflow_key` (P11). Entitlement chỉ đếm `revoked_at IS NULL`. Không cột 24 giờ.
 */
export async function listAgents(
  tx: Tx,
  f: AgentListFilter,
): Promise<{ rows: AgentListDbRow[]; total: number }> {
  const rows = await tx.execute<
    Omit<AgentListDbRow, "updatedAt"> & { updatedAt: Date | string; total: number }
  >(sql`select a.id, a.key, a.name, a.description, a.runtime, a.enabled, a.version, a.updated_at as "updatedAt",
      p.id as "profileId", p.key as "profileKey",
      greatest(
        (select count(*) from hub.agent_workflows aw where aw.agent_id = a.id),
        case when a.runtime in ('dify-workflow', 'dify-agent') and exists (select 1 from admin.workflows w
          where w.key = a.runtime_options->>'workflow_key') then 1 else 0 end
      )::int as "workflowCount",
      (select count(*) from hub.agent_entitlements e
        where e.agent_id = a.id and e.revoked_at is null)::int as "entitledTenantCount",
      exists (select 1 from hub.orchestrator_settings o
        where o.agent_id = a.id and o.tenant_id is null) as "orchDefault",
      coalesce((select array_agg(o.tenant_id::text order by o.tenant_id) from hub.orchestrator_settings o
        where o.agent_id = a.id and o.tenant_id is not null), '{}'::text[]) as "orchTenants",
      (count(*) over ())::int as total
    from hub.agents a left join hub.model_profiles p on p.id = a.profile_id
    where ${listWhere(f)}
    order by a.key
    limit ${f.limit} offset ${f.offset}`);
  const total = rows[0]?.total ?? (await countAgents(tx, f));
  return {
    rows: rows.map(({ total: _t, ...r }) => ({ ...r, updatedAt: iso(r.updatedAt) })),
    total,
  };
}

/** Trang rỗng (offset vượt) vẫn trả `total` đúng. */
async function countAgents(tx: Tx, f: AgentListFilter): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from hub.agents a where ${listWhere(f)}`,
  );
  return r?.n ?? 0;
}

export type AgentUpdate = Omit<AgentInsert, "key" | "runtime">;

/** PUT · `key`/`runtime` bất biến (QB5) — không nằm trong SET. */
export async function updateAgent(tx: Tx, id: string, a: AgentUpdate): Promise<AgentDbRow> {
  const [r] =
    await tx.execute<RawAgent>(sql`update hub.agents as a set name = ${JSON.stringify(a.name)}::jsonb,
      description = ${a.description}, agent_type_key = ${a.agentTypeKey}::text, profile_id = ${a.profileId}::uuid,
      system_prompt = ${a.systemPrompt}, runtime_options = ${JSON.stringify(a.runtimeOptions)}::jsonb,
      timeout_s = ${a.timeoutS}::int, token_budget = ${a.tokenBudget}::int, enabled = ${a.enabled}::boolean,
      version = a.version + 1, updated_at = now()
    where a.id = ${id}::uuid
    returning ${AGENT_COLS}`);
  if (!r) throw new Error("update hub.agents không trả hàng");
  return toRow(r);
}

export async function setAgentEnabled(tx: Tx, id: string, enabled: boolean): Promise<AgentDbRow> {
  const [r] = await tx.execute<RawAgent>(sql`update hub.agents as a
    set enabled = ${enabled}::boolean, version = a.version + 1, updated_at = now()
    where a.id = ${id}::uuid
    returning ${AGENT_COLS}`);
  if (!r) throw new Error("update hub.agents không trả hàng");
  return toRow(r);
}

/** Đồng bộ `agent_workflows`: xoá id không còn trong danh sách mới (thêm mới do `insertAgentWorkflows`). */
export async function deleteAgentWorkflowsExcept(
  tx: Tx,
  agentId: string,
  keep: readonly string[],
): Promise<void> {
  await tx.execute(sql`delete from hub.agent_workflows
    where agent_id = ${agentId}::uuid and not (workflow_id = any(${uuidArr(keep)}))`);
}

/** R-K2: gọi dưới scope `system` (RLS `runs`/`run_steps` theo tenant không che hàng). */
export async function agentHasHistory(tx: Tx, agentId: string): Promise<boolean> {
  const [r] = await tx.execute<{ h: boolean }>(sql`select (
      exists (select 1 from hub.runs where agent_id = ${agentId}::uuid)
      or exists (select 1 from hub.run_steps where agent_id = ${agentId}::uuid)) as h`);
  return r?.h === true;
}

/** Entitlement còn hiệu lực (`revoked_at IS NULL`) + grant (R06). */
export async function agentAccessCounts(
  tx: Tx,
  agentId: string,
): Promise<{ entitlements: number; grants: number }> {
  const [r] = await tx.execute<{ entitlements: number; grants: number }>(sql`select
      (select count(*) from hub.agent_entitlements
        where agent_id = ${agentId}::uuid and revoked_at is null)::int as entitlements,
      (select count(*) from hub.agent_grants where agent_id = ${agentId}::uuid)::int as grants`);
  return r ?? { entitlements: 0, grants: 0 };
}

/** Cascade `agent_workflows` + entitlement đã thu hồi; `flows.agent_id` SET NULL (FK DB). */
export async function deleteAgent(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`delete from hub.agents where id = ${id}::uuid`);
}
