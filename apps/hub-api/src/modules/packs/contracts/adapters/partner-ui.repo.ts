// CR-124 · q4 · SQL cho màn hình: hộp «Hợp đồng đối tác gửi» (bên nhận), trạng thái các vòng gửi (bên gửi), lời mời nối, ghi nhận thủ công, cài đặt nhận.
// Mỗi hàm MỘT câu, lọc `tenant_id` tường minh + RLS gói. Lời mời nối / trả lời đi qua hàm DEFINER `hub.partner_*` (gói không đọc hộp thư).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { contractNameSql } from "./contract-name.sql";

export type InboxRow = {
  contract_id: string;
  title: string;
  sender_name: string;
  sender_tax_code: string | null;
  sender_verified: boolean;
  round: number;
  prev_reason: string | null;
  importance: string;
  message: string | null;
  expires_at: string;
  status: string;
  reason: string | null;
  owner_user_id: string | null;
  created_at: string;
};
export type InviteRow = {
  from_tenant: string;
  from_name: string;
  from_tax_code: string | null;
  from_verified: boolean;
  held: number;
  requested_at: string;
};
export type SendRow = {
  mailbox_id: string;
  round: number;
  channel: string;
  to_name: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  closed_at: string | null;
  /** Trạng thái hộp thư phía gửi (`held` = chờ công ty nhận đồng ý kết nối) và hạn trả lời — từ hàm DEFINER `partner_mailbox_mine`. */
  mb_status: string | null;
  expires_at: string | null;
};

const listings = (tx: Tx, tid: string) => ({
  inbox: (): Promise<InboxRow[]> =>
    tx.execute<InboxRow>(sql`select i.contract_id::text, ${contractNameSql("c")} as title, i.sender_name, i.sender_tax_code, i.sender_verified,
          i.round, i.prev_reason, i.importance, i.message, i.expires_at, i.status, i.reason,
          c.owner_user_id::text as owner_user_id, i.created_at
        from contracts.partner_inbox i join contracts.contracts c on c.id = i.contract_id and c.tenant_id = i.tenant_id
        where i.tenant_id = ${tid}::uuid order by i.created_at desc limit 200`),
  invites: (): Promise<InviteRow[]> =>
    tx.execute<InviteRow>(sql`select from_tenant::text, from_name, from_tax_code, from_verified, held, requested_at
        from hub.partner_link_invites()`),
  async accept(from: string): Promise<void> {
    await tx.execute(sql`select hub.partner_link_accept(${from}::uuid)`);
  },
  async block(from: string): Promise<void> {
    await tx.execute(sql`select hub.partner_link_block(${from}::uuid)`);
  },
  /** Các vòng gửi của MỘT HĐ (RLS: chỉ thấy khi thấy được HĐ). */
  sends: (contractId: string): Promise<SendRow[]> =>
    tx.execute<SendRow>(sql`select s.mailbox_id::text, s.round, s.channel, s.to_name, s.status, s.reason, s.created_at, s.closed_at,
          m.status as mb_status, m.expires_at
        from contracts.partner_sends s join contracts.contracts c on c.id = s.contract_id and c.tenant_id = s.tenant_id
        left join hub.partner_mailbox_mine(500) m on m.id = s.mailbox_id and m.direction = 'out'
        where s.tenant_id = ${tid}::uuid and s.contract_id = ${contractId}::uuid order by s.round desc limit 50`),
  /** Lần gửi MỞ thuộc HĐ mà người gọi thấy được — điều kiện để ghi nhận thủ công (người không phụ trách ⇒ 0 dòng ⇒ 404). */
  async openSend(mailboxId: string): Promise<{ channel: string } | null> {
    const [r] = await tx.execute<{
      channel: string;
    }>(sql`select s.channel from contracts.partner_sends s
        join contracts.contracts c on c.id = s.contract_id and c.tenant_id = s.tenant_id
        where s.tenant_id = ${tid}::uuid and s.mailbox_id = ${mailboxId}::uuid and s.status = 'open'`);
    return r ?? null;
  },
});

const writes = (tx: Tx, tid: string) => ({
  async recordManual(
    mailboxId: string,
    outcome: string,
    reason: string | null,
    evidence: Record<string, unknown>,
  ): Promise<boolean> {
    const [r] = await tx.execute<{
      ok: boolean;
    }>(sql`select hub.partner_reply(${mailboxId}::uuid, ${outcome}, ${reason},
        'manual', ${JSON.stringify(evidence)}::jsonb) as ok`);
    return r?.ok === true;
  },
  async settings() {
    const [r] = await tx.execute<{
      imp: string;
      cri: string;
      owner: string | null;
      sg: string | null;
    }>(sql`
        select important_min::text as imp, critical_min::text as cri, owner_user_id::text as owner,
          signer_group_id::text as sg
        from contracts.partner_settings where tenant_id = ${tid}::uuid`);
    return {
      important_min: Number(r?.imp ?? 500_000_000),
      critical_min: Number(r?.cri ?? 2_000_000_000),
      owner_user_id: r?.owner ?? null,
      signer_group_id: r?.sg ?? null,
    };
  },
  /** Lưu cài đặt; người phụ trách (nếu có) phải là thành viên của CHÍNH công ty (hàm DEFINER, một EXISTS). Sai ⇒ false, không ghi. */
  async saveSettings(
    s: {
      important_min: number;
      critical_min: number;
      owner_user_id: string | null;
      /** `undefined` ⇒ giữ nguyên nhóm «Người ký HĐ» đã lưu. */
      signer_group_id?: string | null | undefined;
    },
    by: string,
  ): Promise<boolean> {
    const r = await tx.execute<{ tenant_id: string }>(sql`insert into contracts.partner_settings
          (tenant_id, important_min, critical_min, owner_user_id, updated_by, signer_group_id)
        select ${tid}::uuid, ${s.important_min}, ${s.critical_min}, ${s.owner_user_id}::uuid, ${by}::uuid,
          ${s.signer_group_id ?? null}::uuid
        where ${s.owner_user_id}::uuid is null or hub.partner_is_member(${s.owner_user_id}::uuid)
        on conflict (tenant_id) do update set important_min = excluded.important_min, critical_min = excluded.critical_min,
          owner_user_id = excluded.owner_user_id, updated_by = excluded.updated_by, updated_at = now(),
          signer_group_id = case when ${s.signer_group_id !== undefined}::boolean then excluded.signer_group_id
            else contracts.partner_settings.signer_group_id end
        returning tenant_id::text`);
    return r.length > 0;
  },
});

export const partnerUiRepo = (tx: Tx, tid: string) => ({
  ...listings(tx, tid),
  ...writes(tx, tid),
});
export type PartnerUiRepo = ReturnType<typeof partnerUiRepo>;
