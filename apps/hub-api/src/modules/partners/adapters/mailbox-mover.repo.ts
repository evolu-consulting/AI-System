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

/** CR-127 · P1 · dòng phiên ký chung cần báo (đã tính chuyển do hạn). */
export type ClaimedSession = {
  id: string;
  status: string;
  eff:
    | "accepted"
    | "signing"
    | "done"
    | "cancelled"
    | "declined"
    | "expired"
    | "fallback"
    | "proposed";
  expire_choice: "resend" | "stop" | null;
  from_tenant: string;
  to_tenant: string;
  notify_from: boolean;
  notify_to: boolean;
  cancel_side: "from" | "to" | null;
  cancel_reason: string | null;
};

/**
 * CR-127 · P1 · nhận lô phiên ký có cờ chưa báo HOẶC vừa quá hạn (proposed quá hạn trả lời ⇒ `fallback`; đang ký quá hạn ký ⇒ `expired`)
 * — MỘT câu, `FOR UPDATE SKIP LOCKED` (giữ khoá tới `finishSessions` cùng tx: hàm `sign_session_*` của người dùng chờ, không đè trạng thái).
 */
export async function claimSessions(tx: Tx, limit: number): Promise<ClaimedSession[]> {
  return tx.execute<ClaimedSession>(sql`
    select id::text as id, status, expire_choice, from_tenant::text as from_tenant, to_tenant::text as to_tenant,
      cancel_side, cancel_reason, d.eff,
      (not emitted_from or d.eff <> status) as notify_from, (not emitted_to or d.eff <> status) as notify_to
    from hub.partner_sign_sessions s,
      lateral (select case
        when s.status = 'proposed' and s.accept_deadline_at <= now() then 'fallback'
        when s.status in ('accepted', 'signing') and s.sign_deadline_at <= now() then 'expired'
        else s.status end as eff) d
    where not (s.emitted_from and s.emitted_to)
      or (s.status = 'proposed' and s.accept_deadline_at <= now())
      or (s.status in ('accepted', 'signing') and s.sign_deadline_at <= now())
    order by s.updated_at limit ${limit}
    for update of s skip locked`);
}

/** CR-127 · P1 · chốt lô đã báo gói: ghi trạng thái do hạn + bật cờ đã báo hai bên — MỘT câu theo tập (`jsonb_to_recordset`). */
export async function finishSessions(
  tx: Tx,
  rows: readonly { id: string; status: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`
    with u as (
      update hub.partner_sign_sessions s set status = x.status, emitted_from = true, emitted_to = true,
        updated_at = case when s.status <> x.status then now() else s.updated_at end
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(id uuid, status text)
      where s.id = x.id
      returning 1
    )
    select count(*)::int as n from u`);
  return r?.n ?? 0;
}
