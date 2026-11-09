// CR-126 · «Vào app + email báo» · SQL của thư BÁO cho kênh nền tảng (scope system, tx của người gọi; policy `partner_mailbox_system` của hub 0117).
// Dòng kênh nền tảng có `to_email`, đã được thả (`sent`/`delivered`, KHÔNG `held`), chưa báo (`email_sent_at` null) ⇒ dùng lại cột thuê/thử/lỗi của đường
// email (hub 0120) — không migration. Mỗi hàm = MỘT câu văn bản hằng (Luật 4c), số câu mỗi lô không phụ thuộc số dòng.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { EmailSettle } from "./email.repo";

export type ClaimedNotice = {
  id: string;
  from_tenant: string;
  to_email: string;
  round: number;
  payload: Record<string, unknown>;
  expires_at: string | Date;
  attempts: number;
};

/**
 * Thuê lô dòng cần báo (SKIP LOCKED + thuê + tăng số lần thử, tối đa 5). `created_at` giới hạn 31 ngày (hạn trả lời ≤ 30 ngày) để quét theo
 * `partner_mailbox_move_idx (status, created_at)` mà không đọc mãi các dòng `delivered` cũ.
 */
export async function claimNotices(
  tx: Tx,
  limit: number,
  leaseS: number,
): Promise<ClaimedNotice[]> {
  return tx.execute<ClaimedNotice>(sql`with c as (
      select m.id from hub.partner_mailbox m
       where m.status in ('sent', 'delivered') and m.created_at > now() - interval '31 days'
         and m.channel = 'platform' and m.to_email is not null and m.email_sent_at is null
         and m.expires_at > now() and m.email_attempts < 5
         and (m.email_lease_until is null or m.email_lease_until < now())
       order by m.created_at limit ${limit}::int for update skip locked
    )
    update hub.partner_mailbox m
       set email_lease_until = now() + make_interval(secs => ${leaseS}::int),
           email_attempts = m.email_attempts + 1, updated_at = now()
      from c where m.id = c.id
    returning m.id::text as id, m.from_tenant::text as from_tenant, m.to_email, m.round, m.payload, m.expires_at,
              m.email_attempts as attempts`);
}

/** Chốt kết cục cả lô: thành công ⇒ `email_sent_at` (không gửi lại); lỗi ⇒ nghỉ bậc thang, vĩnh viễn ⇒ dừng. Nhật ký 'sent'/'error' CÙNG câu. */
export async function settleNotices(tx: Tx, rows: readonly EmailSettle[]): Promise<number> {
  if (rows.length === 0) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`with x as (
      select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(id uuid, ok boolean, permanent boolean, err text, sha text)
    ), u as (
      update hub.partner_mailbox m set
        email_sent_at = case when x.ok then now() end,
        email_error = case when x.ok then null else left(x.err, 200) end,
        email_attempts = case when not x.ok and x.permanent then 5 else m.email_attempts end,
        email_lease_until = case when x.ok then null
          else now() + make_interval(secs => least(300 * m.email_attempts, 3600)) end,
        updated_at = now()
      from x where m.id = x.id and m.channel = 'platform' and m.email_sent_at is null
      returning m.id
    ), ev as (
      insert into hub.partner_email_events (mailbox_id, event, detail)
      select x.id, case when x.ok then 'sent' else 'error' end, left(coalesce(x.err, 'notice'), 300) from x
      where x.id in (select id from u)
      returning 1
    )
    select (select count(*) from u)::int as n`);
  return r?.n ?? 0;
}
