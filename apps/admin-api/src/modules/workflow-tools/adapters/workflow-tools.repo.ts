// ADM-FR-73 · TT-R01…R03 (plan-d2 §6, §8, §9) · adapter Drizzle cho `admin.tenant_workflow_tools` (RLS admin_rw, scope
// platform). Số câu cố định: list 1 (+1 kiểm tenant), lockOne 2, ghi 1 — không phụ thuộc số workflow (Luật 4c).
import { type Tx, tenants, tenantWorkflowTools as twt, workflows } from "@ai/db";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { usernameOf } from "../../../lib/sql";
import { hubAgentsReadable } from "../../workflows/workflows.hub";
import type {
  CompanyView,
  SwitchKey,
  SwitchRow,
  ToolTarget,
  ToolView,
  UsageView,
  WorkflowToolsRepo,
} from "../application";

const switchCols = {
  revokedAt: twt.revokedAt,
  grantedAt: twt.grantedAt,
  grantedBy: usernameOf(twt.grantedBy),
};
const keyOf = (k: SwitchKey) => and(eq(twt.workflowId, k.workflowId), eq(twt.tenantId, k.tenantId));
const one = (rows: SwitchRow[]): SwitchRow | null => rows[0] ?? null;

async function lockOne(tx: Tx, k: SwitchKey): Promise<ToolTarget | null> {
  const [w] = await tx
    .select({
      workflowId: workflows.id,
      key: workflows.key,
      name: workflows.name,
      sideEffect: workflows.sideEffect,
      enabled: workflows.enabled,
      tenantOk: sql<boolean>`exists (select 1 from ${tenants} where ${tenants.id} = ${k.tenantId})`,
    })
    .from(workflows)
    .where(eq(workflows.id, k.workflowId));
  if (!w?.tenantOk) return null;
  const rows = await tx.select(switchCols).from(twt).where(keyOf(k)).for("update");
  const { tenantOk: _ok, ...rest } = w;
  return { ...rest, cur: one(rows) };
}

function listTools(tx: Tx, tenantId: string, limit: number): Promise<ToolView[]> {
  const on = and(
    eq(twt.workflowId, workflows.id),
    eq(twt.tenantId, tenantId),
    isNull(twt.revokedAt),
  );
  return tx
    .select({
      workflowId: workflows.id,
      key: workflows.key,
      name: workflows.name,
      sideEffect: workflows.sideEffect,
      enabled: workflows.enabled,
      on: sql<boolean>`${twt.workflowId} is not null`,
      grantedAt: twt.grantedAt,
      grantedBy: usernameOf(twt.grantedBy),
    })
    .from(workflows)
    .leftJoin(twt, on)
    .orderBy(asc(workflows.key))
    .limit(limit);
}

/** Số câu SQL của `usage()` — cố định, không theo số công cụ (Luật 4c; int `USAGE_QUERIES`). */
export const USAGE_QUERIES = 2;

// Mỗi nhánh: id, tên, bật?, số công ty (đếm riêng) + ≤ 5 tên công ty đầu — subquery tương quan trong MỘT câu cho cả danh mục.
const names = (from: string, where: string) =>
  `(select coalesce(array_agg(n.name order by n.name), '{}') from
    (select distinct t.name from ${from} where ${where} order by t.name limit 5) n)`;
const AGENT_SQL = `select 'agent' as kind, a.id, null::text as name, null::text as description, true as enabled,
    false as side_effect,
    (select count(distinct g.tenant_id)::int from hub.agent_grants g where g.agent_id = a.id) as cc,
    ${names("hub.agent_grants g join admin.tenants t on t.id = g.tenant_id", "g.agent_id = a.id")} as companies
  from (select agent_id as id from hub.agent_workflows union select agent_id from hub.agent_grants order by 1 limit $1) a`;
const COMMAND_SQL = `select 'command', c.id, c.name, null::text, c.enabled, false,
    (select count(distinct e.tenant_id)::int from admin.feature_commands fc
       join admin.feature_entitlements e on e.feature_id = fc.feature_id and e.revoked_at is null where fc.command_id = c.id),
    ${names("admin.feature_commands fc join admin.feature_entitlements e on e.feature_id = fc.feature_id and e.revoked_at is null join admin.tenants t on t.id = e.tenant_id", "fc.command_id = c.id")}
  from (select * from admin.commands order by name limit $1) c`;
const WORKFLOW_SQL = `select 'workflow', w.id, w.name, w.description, w.enabled, w.side_effect,
    (select count(*)::int from admin.tenant_workflow_tools x where x.workflow_id = w.id and x.revoked_at is null),
    ${names("admin.tenant_workflow_tools x join admin.tenants t on t.id = x.tenant_id", "x.workflow_id = w.id and x.revoked_at is null")}
  from (select * from admin.workflows order by key limit $1) w`;

type UsageRow = {
  kind: UsageView["kind"];
  id: string;
  name: string | null;
  description: string | null;
  enabled: boolean;
  side_effect: boolean;
  cc: number;
  companies: string[];
};

/** Danh sách gộp: 2 câu cố định (kiểm quyền đọc bảng Hub + MỘT UNION ALL), không theo số công cụ/công ty. */
async function usageOf(tx: Tx, limit: number, withWorkflows: boolean): Promise<UsageView[]> {
  const hub = await hubAgentsReadable(tx);
  const parts = [
    ...(hub ? [AGENT_SQL] : []),
    COMMAND_SQL,
    ...(withWorkflows ? [WORKFLOW_SQL] : []),
  ];
  const lim = String(Math.trunc(limit));
  const rows = (await tx.execute(
    sql.raw(parts.map((p) => `(${p.replaceAll("$1", lim)})`).join(" union all ")),
  )) as unknown as UsageRow[];
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    sideEffect: r.side_effect,
    companiesCount: r.cc,
    companies: r.companies,
  }));
}
function companiesOf(tx: Tx, workflowId: string, limit: number): Promise<CompanyView[]> {
  const on = and(
    eq(twt.tenantId, tenants.id),
    eq(twt.workflowId, workflowId),
    isNull(twt.revokedAt),
  );
  return tx
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      on: sql<boolean>`${twt.workflowId} is not null`,
      grantedAt: twt.grantedAt,
      grantedBy: usernameOf(twt.grantedBy),
    })
    .from(tenants)
    .leftJoin(twt, on)
    .orderBy(asc(tenants.name), asc(tenants.id))
    .limit(limit);
}

export function workflowToolsRepo(tx: Tx): WorkflowToolsRepo {
  return {
    usage: (limit, withWorkflows) => usageOf(tx, limit, withWorkflows),
    async workflowExists(workflowId) {
      const [r] = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.id, workflowId));
      return !!r;
    },
    companies: (workflowId, limit) => companiesOf(tx, workflowId, limit),
    async tenantExists(tenantId) {
      const [r] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
      return !!r;
    },
    list: (tenantId, limit) => listTools(tx, tenantId, limit),
    lockOne: (k) => lockOne(tx, k),
    async insert(k, actorId) {
      const rows = await tx
        .insert(twt)
        .values({ workflowId: k.workflowId, tenantId: k.tenantId, grantedBy: actorId })
        .onConflictDoNothing()
        .returning(switchCols);
      return one(rows);
    },
    async reactivate(k, actorId) {
      const rows = await tx
        .update(twt)
        .set({ revokedAt: null, grantedBy: actorId, grantedAt: sql`now()` })
        .where(and(keyOf(k), isNotNull(twt.revokedAt)))
        .returning(switchCols);
      return one(rows);
    },
    async revoke(k) {
      const rows = await tx
        .update(twt)
        .set({ revokedAt: sql`now()` })
        .where(and(keyOf(k), isNull(twt.revokedAt)))
        .returning(switchCols);
      return one(rows);
    },
  };
}
