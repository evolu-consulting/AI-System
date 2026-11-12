// CR-127 · E6 · Luật 4c · SQL của vòng lịch — câu văn bản hằng, dữ liệu lô qua mảng `= any` / một tham số JSON. Gọi trong tx scope system.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { FlowFacts } from "../../packs/kit/public";

/** Một (công ty × sự kiện × N thô) có flow đang bật. MỘT câu cho cả lượt. */
export type ScheduledFlowRow = {
  tenant_id: string;
  event: string;
  days: string | null;
  timezone: string | null;
};

export async function scheduledFlows(
  tx: Tx,
  events: readonly string[],
): Promise<ScheduledFlowRow[]> {
  if (events.length === 0) return [];
  return tx.execute<ScheduledFlowRow>(sql`select distinct cf.tenant_id::text as tenant_id,
      d.trigger_event as event, d.trigger -> 'params' ->> 'days' as days, t.timezone
    from hub.company_flows cf
    join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null
      and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
    join admin.tenants t on t.id = cf.tenant_id
    where cf.enabled and d.trigger_event = any(${`{${events.join(",")}}`}::text[])
    order by 1, 2, 3`);
}

export type ScheduledEmit = {
  tenant_id: string;
  event_id: string;
  event: string;
  ref: string;
  facts: FlowFacts;
  actor_id: string | null;
  days: number;
};

/** Lượt đã kết thúc (≡ `flow-engine.ts#inspect`). */
const CLOSED = `{done,cancelled,failed,expired,rejected}`;

/**
 * Phát lô sự kiện lịch MỘT câu: trùng `(tenant, event_id)` ⇒ bỏ (idempotent: chạy lại cùng ngày / hai Hub ⇒ một lượt); đối tượng đã có
 * sự kiện CÙNG (sự kiện, N) đang chờ hoặc lượt còn mở (mốc khác hạn — #55) ⇒ bỏ. Trả số sự kiện mới.
 */
export async function emitScheduled(tx: Tx, rows: readonly ScheduledEmit[]): Promise<number> {
  if (rows.length === 0) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`with x as (
      select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        as x(tenant_id uuid, event_id text, event text, ref text, facts jsonb, actor_id uuid, days int)),
    ins as (
      insert into hub.flow_events (tenant_id, event_id, event, ref, facts, actor_id)
      select x.tenant_id, x.event_id, x.event, x.ref, x.facts, x.actor_id from x
      where not exists (select 1 from hub.flow_events fe
        where fe.tenant_id = x.tenant_id and fe.ref = x.ref and fe.event = x.event and fe.event_id <> x.event_id
          and fe.facts ->> 'days' = x.days::text
          and (fe.processed_at is null or exists (select 1 from hub.process_runs pr
            where pr.flow_event_id = fe.id and pr.tenant_id = fe.tenant_id and pr.status <> all(${CLOSED}::text[]))))
      on conflict (tenant_id, event_id) do nothing
      returning 1)
    select count(*)::int as n from ins`);
  return Number(r?.n ?? 0);
}
