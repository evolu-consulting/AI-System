// [AUDIT] · lịch sử HĐ cho việc trên task duyệt (nhận / trả / giao lại / tự trả quá giờ / chuyển cấp): `contract_events`
// `task_handled`. MỘT câu theo tập (`jsonb_to_recordset`), nối lượt engine của tenant theo `engine_run_id` (run tenant khác ⇒ không
// khớp ⇒ không ghi). Idempotent theo `key` (task × loại × lúc) — không cần index mới: lọc theo HĐ (index `contract_id`) rồi `data.key`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { TaskEventsRepo } from "../application/approval-engine.ports";

export const TASK_EVENT = "task_handled";

export function taskEventsRepo(tx: Tx, tid: string): TaskEventsRepo {
  return {
    async record(rows) {
      if (rows.length === 0) return 0;
      const json = JSON.stringify(
        rows.map((r) => ({
          run: r.runId,
          task: r.taskId,
          stage: r.stageKey,
          kind: r.kind,
          actor: r.actor,
          to: r.to,
          reason: r.reason,
          key: r.key,
          at: r.at,
        })),
      );
      const out = await tx.execute(sql`insert into contracts.contract_events
          (tenant_id, contract_id, type, actor_user_id, data, at)
        select a.tenant_id, a.contract_id, ${TASK_EVENT}, r.actor,
          jsonb_strip_nulls(jsonb_build_object('run_id', a.id::text, 'task_id', r.task, 'stage', r.stage, 'kind', r.kind,
            'to', r.to, 'reason', r.reason, 'key', r.key)),
          r.at
        from (select distinct on (key) * from jsonb_to_recordset(${json}::jsonb)
            as x(run uuid, task text, stage text, kind text, actor uuid, "to" text, reason text, key text, at timestamptz)) r
        join contracts.approvals a on a.tenant_id = ${tid}::uuid and a.engine_run_id = r.run and a.mode = 'engine'
        where not exists (select 1 from contracts.contract_events e where e.tenant_id = a.tenant_id
          and e.contract_id = a.contract_id and e.type = ${TASK_EVENT} and e.data ->> 'key' = r.key)
        returning id`);
      return out.length;
    },
  };
}
