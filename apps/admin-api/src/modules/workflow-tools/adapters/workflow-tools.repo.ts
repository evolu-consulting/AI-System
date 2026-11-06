// ADM-FR-73 · TT-R01…R03 (plan-d2 §6, §8, §9) · adapter Drizzle cho `admin.tenant_workflow_tools` (RLS admin_rw, scope
// platform). Số câu cố định: list 1 (+1 kiểm tenant), lockOne 2, ghi 1 — không phụ thuộc số workflow (Luật 4c).
import { commands, type Tx, tenants, tenantWorkflowTools as twt, workflows } from "@ai/db";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { outer, usernameOf } from "../../../lib/sql";
import { agentCountExpr, hubAgentsReadable } from "../../workflows/workflows.hub";
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

/** CR-121 c16 · "Dùng bởi": đếm command/agent/công ty bằng subquery tương quan trong MỘT câu cho cả danh mục. */
async function usageOf(tx: Tx, limit: number): Promise<UsageView[]> {
  const readable = await hubAgentsReadable(tx);
  const commandCount = sql<number>`(select count(*)::int from ${commands}
    where ${commands.workflowId} = ${outer(workflows.id)})`;
  const companyCount = sql<number>`(select count(*)::int from ${twt}
    where ${twt.workflowId} = ${outer(workflows.id)} and ${twt.revokedAt} is null)`;
  const rows = await tx
    .select({
      workflowId: workflows.id,
      key: workflows.key,
      name: workflows.name,
      description: workflows.description,
      enabled: workflows.enabled,
      sideEffect: workflows.sideEffect,
      agentCount: agentCountExpr(readable, workflows.id),
      commandCount,
      companyCount,
    })
    .from(workflows)
    .orderBy(asc(workflows.key))
    .limit(limit);
  return rows;
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
    usage: (limit) => usageOf(tx, limit),
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
