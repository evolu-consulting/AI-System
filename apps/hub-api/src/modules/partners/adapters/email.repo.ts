// CR-124 · q5 · spec §8 · SQL của đường email (scope system, tx của người gọi). Mỗi hàm = MỘT câu văn bản hằng (Luật 4c) — số câu mỗi lô/mỗi
// lần trả lời KHÔNG phụ thuộc số dòng. Kiểm quyền/trạng thái nằm trong hàm DEFINER `hub.partner_email_*` (hub 0120); đây chỉ gọi và ánh xạ kiểu.
// Token KHÔNG qua đây ở dạng rõ: chỉ BĂM (hex 64) đi vào SQL.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ClaimedEmail,
  EmailView,
  ReplyCode,
  ReplyOpts,
  ReplyValues,
  ViewOpts,
} from "../domain/email-view.types";

/** Thuê lô dòng kênh email chưa gửi (SKIP LOCKED + thuê + tăng số lần thử). */
export async function claimEmails(tx: Tx, limit: number, leaseS: number): Promise<ClaimedEmail[]> {
  return tx.execute<ClaimedEmail>(
    sql`select * from hub.partner_email_claim(${limit}::int, ${leaseS}::int)`,
  );
}

/** Ghi BĂM token cho lô vừa thuê (còn thuê & chưa gửi). Trả số dòng ghi. */
export async function setTokenHashes(
  tx: Tx,
  rows: readonly { id: string; hash: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await tx.execute<{ id: string }>(sql`update hub.partner_mailbox m
      set token_hash = decode(x.h, 'hex'), updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(rows.map((r) => ({ id: r.id, h: r.hash })))}::jsonb) as x(id uuid, h text)
    where m.id = x.id and m.channel = 'email' and m.status = 'sent' and m.email_sent_at is null
      and m.email_lease_until > now() returning m.id`);
  return r.length;
}

export type EmailSettle = {
  id: string;
  ok: boolean;
  /** Lỗi vĩnh viễn (địa chỉ sai/miền dành riêng) ⇒ dừng thử lại. */
  permanent: boolean;
  err: string | null;
  sha: string | null;
};

/**
 * Chốt kết cục gửi cả lô: thành công ⇒ `delivered` + `email_sent_at` + băm PDF; lỗi ⇒ giữ `sent`, nghỉ theo bậc thang (5′·lần thử, tối đa 1 giờ),
 * vĩnh viễn ⇒ không thử nữa. Ghi nhật ký 'sent'/'error' CÙNG câu. MỘT câu cho cả lô.
 */
export async function settleEmails(tx: Tx, rows: readonly EmailSettle[]): Promise<number> {
  if (rows.length === 0) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`with x as (
      select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(id uuid, ok boolean, permanent boolean, err text, sha text)
    ), u as (
      update hub.partner_mailbox m set
        status = case when x.ok then 'delivered' else m.status end,
        email_sent_at = case when x.ok then now() end,
        email_error = case when x.ok then null else left(x.err, 200) end,
        email_attempts = case when not x.ok and x.permanent then 5 else m.email_attempts end,
        email_lease_until = case when x.ok then null
          else now() + make_interval(secs => least(300 * m.email_attempts, 3600)) end,
        pdf_sha256 = coalesce(x.sha, m.pdf_sha256), updated_at = now()
      from x where m.id = x.id and m.channel = 'email' and m.email_sent_at is null
      returning m.id
    ), ev as (
      insert into hub.partner_email_events (mailbox_id, event, detail, pdf_sha256)
      select x.id, case when x.ok then 'sent' else 'error' end, left(x.err, 300), x.sha from x
      where x.id in (select id from u)
      returning 1
    )
    select (select count(*) from u)::int as n`);
  return r?.n ?? 0;
}

/** Trang công khai: tra theo BĂM token. Không có dòng ⇒ link không hợp lệ. `audit` ⇒ ghi sự kiện 'opened' (IP rút gọn + user-agent). */
export async function viewByToken(tx: Tx, hashHex: string, o: ViewOpts): Promise<EmailView | null> {
  const [r] = await tx.execute<EmailView>(sql`select * from hub.partner_email_view(
      decode(${hashHex}, 'hex'), ${o.ip}, ${o.ua}, ${o.audit})`);
  return r ?? null;
}

/** Trả lời từ trang công khai ⇒ `hub.partner_email_reply` (cùng `partner_reply_apply` với đường nền tảng/thủ công). */
export async function replyByToken(
  tx: Tx,
  hashHex: string,
  f: ReplyValues,
  o: ReplyOpts,
): Promise<ReplyCode> {
  const [r] = await tx.execute<{ code: ReplyCode }>(sql`select hub.partner_email_reply(
      decode(${hashHex}, 'hex'), ${f.outcome}, ${f.reason || null}, ${f.name}, ${f.title}, ${o.ip}, ${o.ua}) as code`);
  return r?.code ?? "invalid";
}
