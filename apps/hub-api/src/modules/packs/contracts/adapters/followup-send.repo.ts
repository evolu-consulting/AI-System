// W1b · SQL gửi hẹn nhắc chung (Luật 4c): MỘT câu văn bản cố định mỗi lô. `followupDueFinder`: tx role `contracts_job` (chỉ thấy
// tenant_id/due_at/status của hàng `pending`). `followupSendRepo`: tx `contracts_rw` + `app.tenant_id` (RLS FORCE; việc nền ⇒ không user) và
// vẫn lọc `tenant_id` tường minh; claim `FOR UPDATE SKIP LOCKED` (index `followups_pending_idx`), đổi `sent`, `notify.enqueue` cùng câu.
// Mọi trường gửi đi được ép vào trần CHECK của `hub.notifications` (tiêu đề 1…200, thân ≤ 2000 — 0040) ⇒ một hàng cũ có tiêu đề dài
// (followups cho phép 300) không làm cả lô rollback rồi đứng đầu hàng đợi mãi (review B #8).
import type { Db, Tx } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type { FollowupDueFinder, FollowupSendRepo } from "../application/followup-send.usecase";

export function followupDueFinder(db: Db, packKey: string): FollowupDueFinder {
  return {
    next: (now, skip) =>
      withPackJobScope(db, packKey, async (tx) => {
        const [r] = await tx.execute<{ tenant_id: string }>(sql`
          select tenant_id from contracts.followups
          where status = 'pending' and due_at <= ${now.toISOString()}::timestamptz
            and tenant_id <> all(${`{${skip.join(",")}}`}::uuid[])
          order by due_at limit 1`);
        return r?.tenant_id ?? null;
      }),
  };
}

export function followupSendRepo(tx: Tx, tenantId: string): FollowupSendRepo {
  return {
    async sendDue(now, limit, tz) {
      const [r] = await tx.execute<{ claimed: number; notified: number }>(sql`
        with c as (
          select f.id from contracts.followups f
          where f.tenant_id = ${tenantId}::uuid and f.status = 'pending' and f.due_at <= ${now.toISOString()}::timestamptz
          order by f.due_at, f.id limit ${limit}::int
          for update skip locked),
        up as (
          update contracts.followups f set status = 'sent'
          from c where f.id = c.id and f.tenant_id = ${tenantId}::uuid
          returning f.id, f.user_id, f.title, f.note, f.contract_id, f.due_at)
        select (select count(*) from up)::int as claimed,
          notify.enqueue('contracts', coalesce((select jsonb_agg(jsonb_build_object('user_id', up.user_id,
            'kind', 'contract.followup', 'title', left(coalesce(nullif(btrim(up.title), ''), 'Hẹn nhắc'), 200),
            'body', left(trim(both E'\n' from coalesce(up.note, '') || E'\nĐã hẹn nhắc lúc '
              || to_char(up.due_at at time zone ${tz}::text, 'HH24:MI DD/MM') || '.'), 2000),
            'link', case when up.contract_id is null then '/my-work' else '/contracts/' || up.contract_id end,
            'dedup_key', 'followup:' || up.id || ':' || to_char(up.due_at at time zone 'UTC', 'YYYYMMDDHH24MI'))) from up),
            '[]'::jsonb)) as notified`);
      return { claimed: r?.claimed ?? 0, notified: r?.notified ?? 0 };
    },
    async skipHead(now) {
      const [r] = await tx.execute<{ id: string }>(sql`
        with c as (
          select f.id from contracts.followups f
          where f.tenant_id = ${tenantId}::uuid and f.status = 'pending' and f.due_at <= ${now.toISOString()}::timestamptz
          order by f.due_at, f.id limit 1
          for update skip locked)
        update contracts.followups f set status = 'sent'
        from c where f.id = c.id and f.tenant_id = ${tenantId}::uuid
        returning f.id::text as id`);
      return r?.id ?? null;
    },
  };
}
