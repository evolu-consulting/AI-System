// CR-124 · q1 · spec §7 bước 2–3 · NFR-02/03 · câu SQL của bộ chuyển hộp thư (scope system, tx của người gọi). Mỗi câu = MỘT
// lệnh theo tập: nhận lô `FOR UPDATE SKIP LOCKED` (hai Hub không lấy trùng dòng) + ghi `hub.flow_events` (cùng bảng/khoá với
// `hub.emit_flow_event`; `ON CONFLICT (tenant_id, event_id) DO NOTHING` ⇒ idempotent theo `mailbox.id`) + chốt trạng thái dòng.
// `hub.emit_flow_event` là cửa cho role gói (một tenant/tx); bộ chuyển ở scope system ghi thẳng theo policy system của flow_events
// để giữ số câu cố định mỗi lô. Event_id khớp `domain/mailbox-events.rules.ts` (int test kiểm).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { RECEIVED_EVENT } from "../domain/mailbox-events.rules";

type Counts = { moved: number; emitted: number };

/**
 * Kênh nền tảng `sent` ⇒ `contract.received` vào tenant NHẬN (ref = id lần gửi; facts chỉ tham chiếu, không bản chia sẻ) +
 * `delivered`. Không tạo HĐ nhận (q3). actor null: bên nhận chưa có người gây sự kiện (q3 quyết người chạy flow nhận).
 */
export async function deliverSent(tx: Tx, limit: number): Promise<Counts> {
  const [r] = await tx.execute<Counts>(sql`
    with c as (
      select id, from_tenant, to_tenant, round from hub.partner_mailbox
      where status = 'sent' and channel = 'platform'
      order by created_at limit ${limit}
      for update skip locked
    ), ev as (
      insert into hub.flow_events (tenant_id, event_id, event, ref, facts, actor_id)
      select c.to_tenant, 'partner:' || c.id::text, ${RECEIVED_EVENT}, c.id::text,
        jsonb_build_object('mailbox_id', c.id, 'round', c.round, 'from_tenant', c.from_tenant), null
      from c
      on conflict (tenant_id, event_id) do nothing
      returning 1
    ), up as (
      update hub.partner_mailbox m set status = 'delivered', updated_at = now()
      from c where m.id = c.id
      returning 1
    )
    select (select count(*) from up)::int as moved, (select count(*) from ev)::int as emitted`);
  return r ?? { moved: 0, emitted: 0 };
}

/**
 * `replied` chưa phát ⇒ `partner.<outcome>` vào tenant GỬI (ref = `from_ref` của A, vắng ⇒ id lần gửi) + `reply_emitted_at`.
 * facts không chứa `evidence` (bằng chứng ở lịch sử lần gửi, đọc qua `partner_mailbox_mine` phía A).
 */
export async function emitReplies(tx: Tx, limit: number): Promise<Counts> {
  const [r] = await tx.execute<Counts>(sql`
    with c as (
      select id, from_tenant, from_ref, outcome, reason, replied_by_source, round from hub.partner_mailbox
      where status = 'replied' and reply_emitted_at is null
      order by created_at limit ${limit}
      for update skip locked
    ), ev as (
      insert into hub.flow_events (tenant_id, event_id, event, ref, facts, actor_id)
      select c.from_tenant, 'partner:' || c.id::text || ':reply', 'partner.' || c.outcome,
        coalesce(c.from_ref, c.id::text),
        jsonb_strip_nulls(jsonb_build_object('mailbox_id', c.id, 'outcome', c.outcome, 'reason', c.reason,
          'source', c.replied_by_source, 'round', c.round)), null
      from c
      on conflict (tenant_id, event_id) do nothing
      returning 1
    ), up as (
      update hub.partner_mailbox m set reply_emitted_at = now(), updated_at = now()
      from c where m.id = c.id
      returning 1
    )
    select (select count(*) from up)::int as moved, (select count(*) from ev)::int as emitted`);
  return r ?? { moved: 0, emitted: 0 };
}
