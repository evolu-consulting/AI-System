// CR-127 · P1 · BR-60…65 · spec §2.4: phiên ký chung — phía gói (tx scope tenant, role `contracts_rw`). Mọi đổi phiên đi qua hàm DEFINER
// `hub.sign_session_*` (phía suy từ `app.tenant_id`, RAISE `SESSION_*`); bảng gói `contracts.sign_session_refs` gắn HĐ của tenant này với phiên.
// Mỗi thao tác MỘT câu. Bên kia chỉ lộ tên công ty + tên người ký + mốc giờ (`sign_session_mine`).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ExpireChoice, SignSessionStatus } from "../domain/sign-session.rules";

export type SignSessionView = {
  side: "from" | "to";
  status: SignSessionStatus | "proposed";
  expire_choice: ExpireChoice | null;
  reason: string | null;
  accept_deadline_at: string;
  sign_deadline_at: string | null;
  from_company: string | null;
  from_signer_name: string | null;
  from_signed_at: string | null;
  to_company: string | null;
  to_signer_name: string | null;
  to_signed_at: string | null;
  cancel_side: "from" | "to" | null;
  cancel_reason: string | null;
};

export type SessionRef = { session_id: string; contract_id: string; side: "from" | "to" };

const uuids = (ids: readonly string[]) => `{${ids.join(",")}}`;

export function signSessionRepo(tx: Tx, tid: string) {
  const one = async (q: ReturnType<typeof sql>): Promise<string> => {
    const [r] = await tx.execute<{ v: string }>(q);
    return r?.v as string;
  };
  return {
    /** Bên GỬI đề xuất ký cùng lúc cho lần gửi `mailboxId` của HĐ `contractId` (cùng tx `partner_send`) + gắn HĐ. Trả id phiên. */
    propose(i: {
      contractId: string;
      mailboxId: string;
      reason: string | null;
      acceptH: number;
      signH: number;
      pdfSha256: string;
    }): Promise<string> {
      return one(sql`with s as (
          select hub.sign_session_propose(${i.mailboxId}::uuid, ${i.reason}, ${i.acceptH}::int, ${i.signH}::int,
            ${i.pdfSha256}) as id),
        r as (insert into contracts.sign_session_refs (tenant_id, contract_id, session_id, side)
          select ${tid}::uuid, ${i.contractId}::uuid, s.id, 'from' from s on conflict do nothing)
        select s.id::text as v from s`);
    },
    /** Bên NHẬN: gắn HĐ nhận vừa tạo với phiên của lần gửi (theo tập, MỘT câu); lần gửi không có phiên ⇒ bỏ qua. */
    async linkReceived(
      items: readonly { mailboxId: string; contractId: string }[],
    ): Promise<number> {
      if (items.length === 0) return 0;
      const [r] = await tx.execute<{ n: number }>(sql`with i as (
          insert into contracts.sign_session_refs (tenant_id, contract_id, session_id, side)
          select ${tid}::uuid, x.cid, s.session_id, 'to'
          from jsonb_to_recordset(${JSON.stringify(items.map((x) => ({ mid: x.mailboxId, cid: x.contractId })))}::jsonb)
            as x(mid uuid, cid uuid)
          join hub.sign_session_by_mailbox(${uuids(items.map((x) => x.mailboxId))}::uuid[]) s on s.mailbox_id = x.mid
          on conflict do nothing returning 1)
        select count(*)::int as n from i`);
      return r?.n ?? 0;
    },
    /** Bên NHẬN: «Xử lý bình thường» cho mọi phiên của các lần gửi `mailboxIds` — MỘT câu cho cả lô. */
    async fallbackByMailbox(mailboxIds: readonly string[]): Promise<number> {
      if (mailboxIds.length === 0) return 0;
      const [r] = await tx.execute<{
        n: number;
      }>(sql`select count(hub.sign_session_fallback(s.session_id))::int as n
        from hub.sign_session_by_mailbox(${uuids(mailboxIds)}::uuid[]) s`);
      return r?.n ?? 0;
    },
    accept: (sessionId: string, signerName: string | null) =>
      one(sql`select hub.sign_session_accept(${sessionId}::uuid, ${signerName}) as v`),
    fallback: (sessionId: string) =>
      one(sql`select hub.sign_session_fallback(${sessionId}::uuid) as v`),
    markSigned: (sessionId: string, signerName: string | null, pdfSha256: string) =>
      one(
        sql`select hub.sign_session_mark_signed(${sessionId}::uuid, ${signerName}, ${pdfSha256}) as v`,
      ),
    decline: (sessionId: string, reason: string | null) =>
      one(sql`select hub.sign_session_decline(${sessionId}::uuid, ${reason}) as v`),
    cancel: (sessionId: string, reason: string | null) =>
      one(sql`select hub.sign_session_cancel(${sessionId}::uuid, ${reason}) as v`),
    resolve: (sessionId: string, choice: ExpireChoice) =>
      one(sql`select hub.sign_session_resolve(${sessionId}::uuid, ${choice}) as v`),
    async mine(sessionId: string): Promise<SignSessionView | null> {
      const [r] = await tx.execute<SignSessionView>(
        sql`select * from hub.sign_session_mine(${sessionId}::uuid)`,
      );
      return r ?? null;
    },
    /** Phiên mới nhất gắn HĐ (RLS gói lọc tenant). */
    async sessionOf(contractId: string): Promise<string | null> {
      const [r] = await tx.execute<{ id: string }>(sql`select session_id::text as id
        from contracts.sign_session_refs where tenant_id = ${tid}::uuid and contract_id = ${contractId}::uuid
        order by created_at desc limit 1`);
      return r?.id ?? null;
    },
    /** HĐ của tenant này gắn các phiên `ids` — MỘT câu theo tập (bộ chuyển báo theo lô). */
    refsFor(ids: readonly string[]): Promise<SessionRef[]> {
      if (ids.length === 0) return Promise.resolve([]);
      return tx.execute<SessionRef>(sql`select session_id::text as session_id, contract_id::text as contract_id, side
        from contracts.sign_session_refs where tenant_id = ${tid}::uuid and session_id = any(${uuids(ids)}::uuid[])`);
    },
  };
}
export type SignSessionRepo = ReturnType<typeof signSessionRepo>;
