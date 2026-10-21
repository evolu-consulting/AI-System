// dify-workflows · GET /admin/workflows/:id/runs — lịch sử chạy Dify của một workflow (platform_admin, route đã khoá role).
// Nguồn: `hub.dify_runs` (Hub ghi mỗi lời gọi Dify cùng usage). Bảng Hub KHÔNG RLS ⇒ mọi câu lọc `workflow_id` tường minh;
// Hub chưa migrate (không đọc được bảng) ⇒ `available:false`, items rỗng. Một câu SQL cố định/trang (CTE trang → tên tenant/user
// theo PK, không join bảng có RLS). Không trả inputs/app-key; thông báo lỗi do Hub đã che secret.
import type { DifyRun, DifyRunsQuery, DifyRunsResponse } from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { appError } from "../../lib/errors";
import { QUOTA_TZ_OFFSET_MIN } from "../quotas/quotas.rules";
import { difyLogsUrl } from "./workflows.links";
import * as repo from "./workflows.repo";

export type RunsCall = { ctx: { db: Db; difyConsoleUrl?: string | null }; scope: DbScope };

const DAY_MS = 86_400_000;
const vnStart = (day: string): Date =>
  new Date(Date.parse(`${day}T00:00:00Z`) - QUOTA_TZ_OFFSET_MIN * 60_000);

type Row = {
  id: string;
  created_at: Date | string;
  tenant_id: string;
  tenant_name: string | null;
  user_id: string | null;
  user_name: string | null;
  trigger: DifyRun["trigger"];
  status: DifyRun["status"];
  duration_ms: number;
  tokens: string | number;
  error_message: string | null;
  dify_workflow_run_id: string | null;
  dify_conversation_id: string | null;
  total: string | number;
};

/** `hub.dify_runs` đọc được dưới role hiện tại? (Hub có thể lên sau Admin — không cache.) */
export async function difyRunsReadable(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`select coalesce(has_table_privilege(to_regclass('hub.dify_runs'), 'SELECT'), false) as ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

function pageSql(workflowId: string, q: DifyRunsQuery) {
  const from = q.from ? vnStart(q.from).toISOString() : null;
  const to = q.to ? new Date(vnStart(q.to).getTime() + DAY_MS).toISOString() : null;
  return sql`with p as (
      select id, created_at, tenant_id, user_id, trigger, status, duration_ms,
        (input_tokens::bigint + output_tokens) as tokens, error_message,
        dify_workflow_run_id, dify_conversation_id, count(*) over() as total
      from hub.dify_runs
      where workflow_id = ${workflowId}::uuid
        and (${q.tenant_id ?? null}::uuid is null or tenant_id = ${q.tenant_id ?? null}::uuid)
        and (${q.status ?? null}::text is null or status = ${q.status ?? null}::text)
        and (${from}::timestamptz is null or created_at >= ${from}::timestamptz)
        and (${to}::timestamptz is null or created_at < ${to}::timestamptz)
      order by created_at desc, id desc
      limit ${q.limit} offset ${q.offset})
    select p.*,
      (select name from admin.tenants where id = p.tenant_id) as tenant_name,
      (select username from admin.users where id = p.user_id) as user_name
    from p order by p.created_at desc, p.id desc`;
}

function toRun(r: Row, link: string | null): DifyRun {
  return {
    id: r.id,
    at: new Date(r.created_at).toISOString(),
    tenant: { id: r.tenant_id, name: r.tenant_name ?? "" },
    user: r.user_id ? { id: r.user_id, name: r.user_name ?? "" } : null,
    trigger: r.trigger,
    status: r.status,
    duration_ms: r.duration_ms,
    tokens: Number(r.tokens),
    error_message: r.error_message,
    dify_workflow_run_id: r.dify_workflow_run_id,
    dify_conversation_id: r.dify_conversation_id,
    dify_url: link,
  };
}

export function listWorkflowRuns(
  c: RunsCall,
  workflowId: string,
  q: DifyRunsQuery,
): Promise<DifyRunsResponse> {
  return withScope(
    c.ctx.db,
    c.scope,
    async (tx) => {
      const w = await repo.findWorkflow(tx, workflowId, false);
      if (!w) throw appError("NOT_FOUND");
      if (!(await difyRunsReadable(tx))) return { items: [], total: 0, available: false };
      const rows = (await tx.execute(pageSql(workflowId, q))) as unknown as Row[];
      const link = difyLogsUrl(c.ctx.difyConsoleUrl, w.difyAppId);
      return {
        items: rows.map((r) => toRun(r, link)),
        total: Number(rows[0]?.total ?? 0),
        available: true,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
