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

/** CR-124 · q3 · tenant NHẬN còn lần gửi `sent` kênh nền tảng (cũ nhất trước) — MỘT câu; gói nhận từng tenant trong tx scope tenant đó. */
export async function pendingReceivers(tx: Tx, limit: number): Promise<string[]> {
  const rows = await tx.execute<{ to_tenant: string }>(sql`
    select to_tenant::text as to_tenant from hub.partner_mailbox
    where status = 'sent' and channel = 'platform' and expires_at > now()
    group by to_tenant order by min(created_at) limit ${limit}`);
  return rows.map((r) => r.to_tenant);
}

export type ClaimedReply = {
  id: string;
  tenant_id: string;
  ref: string | null;
  outcome: "confirmed" | "returned" | "declined";
  reason: string | null;
  source: string;
  round: number;
};

/** CR-124 · q3 · nhận lô `replied` chưa phát (SKIP LOCKED) để gói báo về tenant GỬI TRƯỚC khi chốt — MỘT câu. */
export async function claimReplies(tx: Tx, limit: number): Promise<ClaimedReply[]> {
  return tx.execute<ClaimedReply>(sql`
    select id, from_tenant::text as tenant_id, from_ref as ref, outcome, reason, replied_by_source as source, round
    from hub.partner_mailbox
    where status = 'replied' and reply_emitted_at is null
    order by created_at limit ${limit}
    for update skip locked`);
}

/** CR-124 · q3 · chốt lô đã báo gói: phát `partner.<outcome>` (như `emitReplies`) + `reply_emitted_at` — MỘT câu theo `id = any`. */
export async function finishReplies(tx: Tx, ids: readonly string[]): Promise<Counts> {
  if (ids.length === 0) return { moved: 0, emitted: 0 };
  const [r] = await tx.execute<Counts>(sql`
    with c as (
      select id, from_tenant, from_ref, outcome, reason, replied_by_source, round from hub.partner_mailbox
      where id = any(${`{${ids.join(",")}}`}::uuid[]) and reply_emitted_at is null
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
