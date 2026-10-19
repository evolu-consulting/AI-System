// HD4-FR-03…05 · HD4-NFR-01/02 · plan §2: SQL vòng nhắc. Văn bản cố định, lô qua MỘT tham số jsonb (Luật 4c).
// `dueTenantFinder`: tx role `contracts_job` (chỉ thấy tenant_id/remind_at). `reminderBatchRepo`: trong tx `contracts_rw` +
// `app.tenant_id` (RLS FORCE) và vẫn lọc `tenant_id` tường minh. Claim theo index `(tenant_id, remind_at)`; áp dụng = 1 câu CTE.
import type { Db, Tx } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type { DueTenantFinder, ReminderBatchRepo } from "../application/remind-due.usecase";
import type { DueContract } from "../domain/deadline.rules";
import type { ContractStatus } from "../domain/status.rules";

export function dueTenantFinder(db: Db, packKey: string): DueTenantFinder {
  return {
    next: (now, skip) =>
      withPackJobScope(db, packKey, async (tx) => {
        const [r] = await tx.execute<{ tenant_id: string }>(sql`
          select tenant_id from contracts.contracts
          where remind_at <= ${now.toISOString()}::timestamptz and tenant_id <> all(${`{${skip.join(",")}}`}::uuid[])
          order by remind_at limit 1`);
        return r?.tenant_id ?? null;
      }),
  };
}

type ClaimRow = {
  id: string;
  status: ContractStatus;
  kind: string;
  outcome: string | null;
  end_date: string | null;
  deadline: string | null;
  owner_user_id: string | null;
  number: string | null;
  direction: string | null;
  seller: string | null;
  buyer: string | null;
  value: string | number | null;
  auto_renew: string | null;
};

const toDue = (r: ClaimRow): DueContract => ({
  id: r.id,
  status: r.status,
  kind: r.kind,
  outcome: r.outcome,
  endDate: r.end_date,
  deadline: r.deadline,
  ownerUserId: r.owner_user_id,
  number: r.number,
  direction: r.direction,
  seller: r.seller,
  buyer: r.buyer,
  value: r.value === null ? null : Number(r.value),
  autoRenew: r.auto_renew === "true" ? true : r.auto_renew === "false" ? false : null,
});

export function reminderBatchRepo(tx: Tx, tenantId: string): ReminderBatchRepo {
  return {
    async claim(now, limit) {
      const rows = await tx.execute<ClaimRow>(sql`
        select c.id, c.status, c.kind, c.handled ->> 'outcome' as outcome, to_char(c.end_date, 'YYYY-MM-DD') as end_date,
          to_char(c.action_deadline, 'YYYY-MM-DD') as deadline, c.owner_user_id, c.number, c.direction, c.seller, c.buyer,
          c.value, c.fields -> 'auto_renew' ->> 'value' as auto_renew
        from contracts.contracts c
        where c.tenant_id = ${tenantId}::uuid and c.remind_at <= ${now.toISOString()}::timestamptz
        order by c.remind_at limit ${limit}
        for update skip locked`);
      return rows.map(toDue);
    },
    async apply(plans) {
      const batch = JSON.stringify(
        plans.map((p) => ({
          id: p.id,
          status: p.status,
          changed: p.changed,
          next_at: p.nextAt?.toISOString() ?? null,
          milestone: p.reminder?.milestone ?? null,
          deadline: p.reminder?.deadline ?? null,
          user_id: p.reminder?.userId ?? null,
          title: p.reminder?.title ?? null,
          body: p.reminder?.body ?? null,
          link: p.reminder?.link ?? null,
        })),
      );
      const [r] = await tx.execute<{ changed: number; reminded: number; notified: number }>(sql`
        with x as (
          select * from jsonb_to_recordset(${batch}::jsonb) as x(id uuid, status text, changed boolean, next_at timestamptz,
            milestone int, deadline date, user_id uuid, title text, body text, link text)
        ), old as (
          select c.id, c.status from contracts.contracts c join x on x.id = c.id where c.tenant_id = ${tenantId}::uuid
        ), upd as (
          update contracts.contracts c set status = x.status, remind_at = x.next_at
          from x where c.id = x.id and c.tenant_id = ${tenantId}::uuid
          returning c.id
        ), rem as (
          insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
          select ${tenantId}::uuid, x.id, x.deadline, x.milestone, x.user_id, 'in_app' from x where x.milestone is not null
          on conflict do nothing
          returning contract_id
        ), sent as (
          select x.* from rem join x on x.id = rem.contract_id
        ), ev as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, x.id, 'status_changed', null::uuid, jsonb_build_object('from', o.status, 'to', x.status)
            from x join old o on o.id = x.id where x.changed
          union all
          select ${tenantId}::uuid, s.id, 'reminded', null::uuid,
            jsonb_build_object('deadline', s.deadline, 'milestone', s.milestone, 'user_id', s.user_id) from sent s
          returning 1
        ), ob as (
          insert into contracts.index_outbox (tenant_id, entity, entity_id, op)
          select ${tenantId}::uuid, 'contract', x.id, 'upsert' from x where x.changed
          returning 1
        )
        select (select count(*) from x where x.changed)::int as changed, (select count(*) from rem)::int as reminded,
          notify.enqueue('contracts', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id,
            'kind', 'contract.deadline', 'title', s.title, 'body', s.body, 'link', s.link,
            'dedup_key', 'remind:' || s.id || ':' || to_char(s.deadline, 'YYYY-MM-DD') || ':' || s.milestone)) from sent s),
            '[]'::jsonb)) as notified,
          (select count(*) from upd) + (select count(*) from ev) + (select count(*) from ob) as touched`);
      return {
        statusChanged: r?.changed ?? 0,
        reminded: r?.reminded ?? 0,
        notified: r?.notified ?? 0,
      };
    },
  };
}
