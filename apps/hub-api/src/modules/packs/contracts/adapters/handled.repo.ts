// HD4-FR-06 · plan §3: SQL ghi kết quả xử lý — khoá một hàng theo PK + tenant, rồi MỘT CTE (update handled/status/version + event).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { HandledLocked, HandledRepo } from "../application/record-handled.usecase";

export function handledRepo(tx: Tx, tenantId: string): HandledRepo {
  return {
    async lock(id) {
      const [r] = await tx.execute<{
        status: HandledLocked["status"];
        kind: string;
        end_date: string | null;
        deadline: string | null;
      }>(sql`
        select status, kind, to_char(end_date, 'YYYY-MM-DD') as end_date, to_char(action_deadline, 'YYYY-MM-DD') as deadline
        from contracts.contracts where id = ${id}::uuid and tenant_id = ${tenantId}::uuid for update`);
      return r
        ? { status: r.status, kind: r.kind, endDate: r.end_date, deadline: r.deadline }
        : null;
    },
    async save(id, s) {
      const [r] = await tx.execute<{ version: number; action_deadline: string | null }>(sql`
        with u as (
          update contracts.contracts set handled = ${JSON.stringify(s.handled)}::jsonb, status = ${s.status},
            version = version + 1, updated_at = now()
          where id = ${id}::uuid and tenant_id = ${tenantId}::uuid
          returning id, version, to_char(action_deadline, 'YYYY-MM-DD') as action_deadline
        ), e as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, u.id, 'handled', ${s.handled.by}::uuid,
            jsonb_build_object('outcome', ${s.handled.outcome}::text, 'from', ${s.prev}::text, 'to', ${s.status}::text) from u
          returning 1
        )
        select version, action_deadline from u`);
      return { version: Number(r?.version), action_deadline: r?.action_deadline ?? null };
    },
  };
}
