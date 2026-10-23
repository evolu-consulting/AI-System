// HD4-FR-03…05 · HD4-NFR-01/02 · plan §2: SQL vòng nhắc. Văn bản cố định, lô qua MỘT tham số jsonb (Luật 4c).
// `dueTenantFinder`: tx role `contracts_job` (chỉ thấy tenant_id/remind_at của `contract_schedule`). `reminderBatchRepo`: trong tx
// `contracts_rw` + `app.tenant_id` (RLS FORCE) và vẫn lọc `tenant_id` tường minh. Claim khoá hàng lịch (`FOR UPDATE OF s SKIP
// LOCKED`, index `(tenant_id, remind_at)`); áp dụng = 1 câu CTE: lịch (nhẹ) + `contracts` chỉ khi đổi trạng thái (D4-11).
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
          select tenant_id from contracts.contract_schedule
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
        join contracts.contract_schedule s on s.contract_id = c.id and s.tenant_id = c.tenant_id
        where s.tenant_id = ${tenantId}::uuid and s.remind_at <= ${now.toISOString()}::timestamptz
          and c.superseded_at is null
        order by s.remind_at limit ${limit}
        for no key update of c, s skip locked`);
      return rows.map(toDue);
    },
    async purgeOrphans(now) {
      // Review m1: hàng lịch mất HĐ (trigger không chạy: replica, restore một phần) hoặc HĐ đã bị thay (CR-097 K2, `claim` bỏ qua)
      // ⇒ xoá, tránh tìm-tenant rỗng mãi. Chỉ chạy
      // khi claim ra 0 hàng (đường hiếm), nên lô thường vẫn 3 câu.
      const r = await tx.execute<{ n: number }>(sql`
        with d as (
          delete from contracts.contract_schedule s where s.contract_id in (
            select s2.contract_id from contracts.contract_schedule s2
            where s2.tenant_id = ${tenantId}::uuid and s2.remind_at <= ${now.toISOString()}::timestamptz
              and not exists (select 1 from contracts.contracts c where c.id = s2.contract_id and c.tenant_id = s2.tenant_id
                and c.superseded_at is null)
            limit 1000)
          returning 1)
        select count(*)::int as n from d`);
      return Number(r[0]?.n ?? 0);
    },
    async apply(plans) {
      const [r] = await tx.execute<{ changed: number; reminded: number; notified: number }>(
        applyQ(tenantId, batchJson(plans)),
      );
      return {
        statusChanged: r?.changed ?? 0,
        reminded: r?.reminded ?? 0,
        notified: r?.notified ?? 0,
      };
    },
  };
}

const batchJson = (plans: Parameters<ReminderBatchRepo["apply"]>[0]) =>
  JSON.stringify(
    plans.map((p) => ({
      id: p.id,
      status: p.status,
      prev: p.prev,
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

/** MỘT câu CTE áp cả lô: trạng thái, lịch, nhắc, sự kiện, outbox, NOTIFY. */
function applyQ(tenantId: string, batch: string) {
  return sql`
        with x as (
          select * from jsonb_to_recordset(${batch}::jsonb) as x(id uuid, status text, prev text, changed boolean, next_at timestamptz,
            milestone int, deadline date, user_id uuid, title text, body text, link text)
        ), upd as (
          update contracts.contracts c set status = x.status
          from x where c.id = x.id and c.tenant_id = ${tenantId}::uuid and x.changed and c.status = x.prev
          returning c.id
        ), sch as (
          update contracts.contract_schedule s set remind_at = x.next_at
          from x where s.contract_id = x.id and s.tenant_id = ${tenantId}::uuid and x.next_at is not null
          returning s.contract_id
        ), unsch as (
          delete from contracts.contract_schedule s using x
          where s.contract_id = x.id and s.tenant_id = ${tenantId}::uuid and x.next_at is null
          returning s.contract_id
        ), rem as (
          insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
          select ${tenantId}::uuid, x.id, x.deadline, x.milestone, x.user_id, 'in_app' from x where x.milestone is not null
          on conflict do nothing
          returning contract_id
        ), sent as (
          select x.* from rem join x on x.id = rem.contract_id
        ), ev as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, x.id, 'status_changed', null::uuid, jsonb_build_object('from', x.prev, 'to', x.status)
            from x join upd on upd.id = x.id
          union all
          select ${tenantId}::uuid, s.id, 'reminded', null::uuid,
            jsonb_build_object('deadline', s.deadline, 'milestone', s.milestone, 'user_id', s.user_id) from sent s
          returning 1
        ), ob as (
          insert into contracts.index_outbox (tenant_id, entity, entity_id, op)
          select ${tenantId}::uuid, 'contract', upd.id, 'upsert' from upd
          returning 1
        )
        select (select count(*) from upd)::int as changed, (select count(*) from rem)::int as reminded,
          notify.enqueue('contracts', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id,
            'kind', 'contract.deadline', 'title', s.title, 'body', s.body, 'link', s.link,
            'lead', s.milestone, 'managed', true,
            'dedup_key', 'remind:' || s.id || ':' || to_char(s.deadline, 'YYYY-MM-DD') || ':' || s.milestone)) from sent s),
            '[]'::jsonb)) as notified,
          (select count(*) from sch) + (select count(*) from unsch) + (select count(*) from ev)
            + (select count(*) from ob) as touched`;
}
