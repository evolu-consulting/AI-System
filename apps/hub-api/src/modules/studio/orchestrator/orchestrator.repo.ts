// HUB-FR-62 · H4a-R07, R09 · plan §5.3, §7 · câu SQL Orchestrator Studio. Transaction + scope `system` do service /
// `withConfigWrite` mở (khoá `config_meta` trước ⇒ `ORCHESTRATOR_EXISTS` không race). Bảng cấu hình không RLS (cách ly bằng
// role). `admin.tenants` đọc không khoá (hub_ro). Cột tương quan viết tường minh alias `o.` / `a.` / `t.`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

const iso = (v: Date | string): string => new Date(v).toISOString();

export type OrchDbRow = {
  id: number;
  tenantId: string | null;
  tenantKey: string | null;
  tenantName: string | null;
  agentId: string;
  agentKey: string;
  agentName: { vi: string; en: string };
  agentRuntime: string;
  agentEnabled: boolean;
  maxSteps: number;
  tokenBudget: number;
  historyN: number;
  onNoMatch: "answer" | "ask";
  version: number;
  updatedBy: string | null;
  updatedAt: string;
};

type RawOrch = Omit<OrchDbRow, "updatedAt"> & { updatedAt: Date | string };

const ORCH_SELECT = sql`select o.id::int as id, o.tenant_id as "tenantId", t.key as "tenantKey", t.name as "tenantName",
    o.agent_id as "agentId", a.key as "agentKey", a.name as "agentName", a.runtime as "agentRuntime",
    a.enabled as "agentEnabled", o.max_steps as "maxSteps", o.token_budget as "tokenBudget", o.history_n as "historyN",
    o.on_no_match as "onNoMatch", o.version, o.updated_by as "updatedBy", o.updated_at as "updatedAt"
  from hub.orchestrator_settings o
  join hub.agents a on a.id = o.agent_id
  left join admin.tenants t on t.id = o.tenant_id`;

const toRow = (r: RawOrch): OrchDbRow => ({ ...r, updatedAt: iso(r.updatedAt) });

/** `tenantId` null = bản mặc định. `forUpdate` khoá riêng hàng `o` (plan §7: sau `config_meta`). */
export async function readOrch(
  tx: Tx,
  tenantId: string | null,
  forUpdate = false,
): Promise<OrchDbRow | undefined> {
  const where = tenantId === null ? sql`o.tenant_id is null` : sql`o.tenant_id = ${tenantId}::uuid`;
  const lock = forUpdate ? sql`for update of o` : sql``;
  const [r] = await tx.execute<RawOrch>(sql`${ORCH_SELECT} where ${where} ${lock}`);
  return r ? toRow(r) : undefined;
}

/** Bản theo tenant, sắp `tenant.key` (≤ 200 — plan §2.4). */
export async function listTenantOrchs(tx: Tx): Promise<OrchDbRow[]> {
  const rows = await tx.execute<RawOrch>(
    sql`${ORCH_SELECT} where o.tenant_id is not null order by t.key limit 200`,
  );
  return rows.map(toRow);
}

export type TenantRef = { id: string; key: string; name: string; active: boolean };

export async function readTenant(tx: Tx, id: string): Promise<TenantRef | undefined> {
  const [r] = await tx.execute<TenantRef>(
    sql`select id, key, name, active from admin.tenants where id = ${id}::uuid`,
  );
  return r;
}

export async function readAgentBrief(
  tx: Tx,
  id: string,
): Promise<{ enabled: boolean; runtime: string } | undefined> {
  const [r] = await tx.execute<{ enabled: boolean; runtime: string }>(
    sql`select enabled, runtime from hub.agents where id = ${id}::uuid`,
  );
  return r;
}

export type OrchFields = {
  agentId: string;
  maxSteps: number;
  tokenBudget: number;
  historyN: number;
  onNoMatch: "answer" | "ask";
};

/** INSERT bản tenant: id từ sequence, KHÔNG `ON CONFLICT` (bẫy `nextval` REVIEW 1 seed). */
export async function insertTenantOrch(
  tx: Tx,
  tenantId: string,
  f: OrchFields,
  by: string,
): Promise<void> {
  await tx.execute(sql`insert into hub.orchestrator_settings
      (tenant_id, agent_id, max_steps, token_budget, history_n, on_no_match, updated_by)
    values (${tenantId}::uuid, ${f.agentId}::uuid, ${f.maxSteps}::int, ${f.tokenBudget}::int, ${f.historyN}::int,
      ${f.onNoMatch}::text, ${by}::uuid)`);
}

export async function updateOrch(tx: Tx, id: number, f: OrchFields, by: string): Promise<void> {
  await tx.execute(sql`update hub.orchestrator_settings set agent_id = ${f.agentId}::uuid,
      max_steps = ${f.maxSteps}::int, token_budget = ${f.tokenBudget}::int, history_n = ${f.historyN}::int,
      on_no_match = ${f.onNoMatch}::text, version = version + 1, updated_by = ${by}::uuid, updated_at = now()
    where id = ${id}::smallint`);
}

export async function deleteOrch(tx: Tx, id: number): Promise<void> {
  await tx.execute(sql`delete from hub.orchestrator_settings where id = ${id}::smallint`);
}
