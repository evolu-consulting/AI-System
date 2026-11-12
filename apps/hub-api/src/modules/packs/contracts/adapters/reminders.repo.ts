// CR-127 K6 · HD4-NFR-01/02 · plan §2: SQL vòng tính lại HIỆU LỰC hằng ngày (bỏ chuông cứng — nhắc đi qua quy trình `contract.expiring`).
// Văn bản cố định, lô qua MỘT tham số jsonb (Luật 4c). `dueTenantFinder`: tx role `contracts_job` (chỉ thấy tenant_id/remind_at của
// `contract_schedule`). `reminderBatchRepo`: trong tx `contracts_rw` + `app.tenant_id` (RLS FORCE) và vẫn lọc `tenant_id` tường minh.
// Claim khoá hàng lịch (`FOR UPDATE OF s SKIP LOCKED`, index `(tenant_id, remind_at)`); áp dụng = 1 câu CTE: `refresh_effect` theo tập
// (nguồn ghi duy nhất của `effect`) + lịch kế tiếp + outbox hàng đổi hiệu lực. Số câu mỗi lô cố định (claim + apply).
import type { Db, Tx } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type { DueTenantFinder, ReminderBatchRepo } from "../application/remind-due.usecase";
import type { DueContract } from "../domain/deadline.rules";
import type { EffectOutcome } from "../domain/effect.rules";
import { DEFAULT_TENANT_TZ, localDate } from "../domain/local-time.rules";

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
  kind: string;
  status: string;
  outcome: EffectOutcome | null;
  start_date: string | null;
  end_date: string | null;
  notice: string | null;
};

const toDue = (r: ClaimRow): DueContract => ({
  id: r.id,
  status: r.status,
  kind: r.kind,
  outcome: r.outcome,
  startDate: r.start_date,
  endDate: r.end_date,
  noticeDays: r.notice,
});

export function reminderBatchRepo(tx: Tx, tenantId: string): ReminderBatchRepo {
  return {
    async claim(now, limit) {
      const rows = await tx.execute<ClaimRow>(sql`
        select c.id, c.status, c.kind, c.effect_outcome as outcome, to_char(c.start_date, 'YYYY-MM-DD') as start_date,
          to_char(c.end_date, 'YYYY-MM-DD') as end_date, c.fields -> 'notice_days' ->> 'value' as notice
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
      // khi claim ra 0 hàng (đường hiếm), nên lô thường vẫn 2 câu.
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
    async apply(plans, today) {
      const [r] = await tx.execute<{ changed: number }>(
        applyQ(tenantId, batchJson(plans), today ?? localDate(new Date(), DEFAULT_TENANT_TZ)),
      );
      return { statusChanged: r?.changed ?? 0 };
    },
  };
}

const batchJson = (plans: Parameters<ReminderBatchRepo["apply"]>[0]) =>
  JSON.stringify(
    plans.map((p) => ({ id: p.id, effect: p.effect, next_at: p.nextAt?.toISOString() ?? null })),
  );

/** MỘT câu CTE áp cả lô: hiệu lực (`refresh_effect`; status KHÔNG đổi), lịch kế tiếp, outbox chỉ hàng đổi hiệu lực. */
function applyQ(tenantId: string, batch: string, today: string) {
  return sql`
        with x as (
          select * from jsonb_to_recordset(${batch}::jsonb) as x(id uuid, effect text, next_at timestamptz)
        ), upd as (
          -- hàng đổi hiệu lực (snapshot trước khi refresh_effect ghi): chỉ để phát outbox; effect chỉ ghi qua refresh_effect.
          select c.id from contracts.contracts c join x on x.id = c.id
          where c.tenant_id = ${tenantId}::uuid and c.effect is distinct from x.effect
        ), rf as (
          select contracts.refresh_effect(coalesce(array(select x.id from x), '{}'::uuid[]), ${today}::date) as n
        ), sch as (
          update contracts.contract_schedule s set remind_at = x.next_at
          from x where s.contract_id = x.id and s.tenant_id = ${tenantId}::uuid and x.next_at is not null
          returning s.contract_id
        ), unsch as (
          delete from contracts.contract_schedule s using x
          where s.contract_id = x.id and s.tenant_id = ${tenantId}::uuid and x.next_at is null
          returning s.contract_id
        ), ob as (
          insert into contracts.index_outbox (tenant_id, entity, entity_id, op)
          select ${tenantId}::uuid, 'contract', upd.id, 'upsert' from upd
          returning 1
        )
        select (select coalesce(sum(n), 0) from rf)::int as changed,
          (select count(*) from sch) + (select count(*) from unsch) + (select count(*) from ob) as touched`;
}
