// tool-tenant-purge · hộp thư đối tác hai bên (hub.partner_mailbox / partner_links / partner_email_events): GIỮ lịch sử của công ty còn lại
// (người dùng chốt 2026-11-08). Bên bị xoá được ẩn danh: id → tombstone `PARTNER_DELETED_TENANT_ID`, mọi dữ liệu của nó trong dòng bị xoá sạch,
// bản sao phía bên kia (contracts.partner_inbox / partner_sends) đổi tên «Công ty đã xoá». Dòng chỉ bị XOÁ khi không còn bên nào để giữ
// lịch sử: bên kia cũng đã xoá (tombstone) / không phải tenant (kênh email, ghi tay) / chưa tới tay bên kia (held, sent) / lời mời nối chưa chấp nhận.
// Chạy TRƯỚC khi xoá bảng theo tenant_id (cần id hộp thư để tìm bản sao phía bên kia). Cùng transaction với phần xoá.
import {
  PARTNER_DELETED_KEY,
  PARTNER_DELETED_NAME,
  PARTNER_DELETED_TENANT_ID,
} from "@ai/contracts/pack-contracts";
import type postgres from "postgres";

type Tx = postgres.TransactionSql;
export type PartnerStats = {
  mailboxDeleted: number;
  mailboxAnonymized: number;
  linksDeleted: number;
  linksAnonymized: number;
  copiesAnonymized: number;
};
export const NO_PARTNER: PartnerStats = {
  mailboxDeleted: 0,
  mailboxAnonymized: 0,
  linksDeleted: 0,
  linksAnonymized: 0,
  copiesAnonymized: 0,
};

const X = `'${PARTNER_DELETED_TENANT_ID}'::uuid`;
/** Bên còn lại của dòng hộp thư đối với tenant `$1`. */
const OTHER = "(case when m.from_tenant = $1::uuid then m.to_tenant else m.from_tenant end)";
/** Dòng hộp thư phải XOÁ (không còn bên nào giữ lịch sử). */
const DOOMED = `select m.id from hub.partner_mailbox m where (m.from_tenant = $1::uuid or m.to_tenant = $1::uuid)
  and (${OTHER} is null or ${OTHER} = ${X} or (m.from_tenant = $1::uuid and m.status in ('held', 'sent')))`;

const count = async (tx: Tx, text: string, tid: string): Promise<number> =>
  (await tx.unsafe(text, [tid])).count;
const has = async (tx: Tx, rel: string): Promise<boolean> =>
  (
    (await tx.unsafe("select to_regclass($1) is not null as ok", [rel])) as unknown as {
      ok: boolean;
    }[]
  )[0]?.ok === true;

/** Ẩn danh bên `tenantId` trong dữ liệu đối tác của các tenant khác; xoá dòng không còn ai giữ lịch sử. */
export async function anonymizePartner(tx: Tx, tenantId: string): Promise<PartnerStats> {
  if (!(await has(tx, "hub.partner_mailbox"))) return NO_PARTNER;
  const out = { ...NO_PARTNER };
  // (1) Bản sao phía bên kia (gói contracts, tenant_id ≠ tenant bị xoá): tên/MST/bản chia sẻ của bên bị xoá.
  if (await has(tx, "contracts.partner_inbox"))
    out.copiesAnonymized += await count(
      tx,
      `update contracts.partner_inbox i set sender_name = '${PARTNER_DELETED_NAME}', sender_tax_code = null, sender_verified = false,
         shared = '{}'::jsonb, message = null, file_ref = null, pdf_sha256 = null
       where i.tenant_id <> $1::uuid and i.mailbox_id in (select m.id from hub.partner_mailbox m where m.from_tenant = $1::uuid)`,
      tenantId,
    );
  if (await has(tx, "contracts.partner_sends"))
    out.copiesAnonymized += await count(
      tx,
      `update contracts.partner_sends s set to_name = '${PARTNER_DELETED_NAME}', to_key = '${PARTNER_DELETED_KEY}'
       where s.tenant_id <> $1::uuid and s.mailbox_id in (select m.id from hub.partner_mailbox m where m.to_tenant = $1::uuid)`,
      tenantId,
    );
  // (2) Hộp thư: xoá dòng không còn ai giữ (nhật ký email trước, rồi dòng; thread tham chiếu `prev_id` sang dòng bị xoá ⇒ NULL).
  await tx.unsafe(`delete from hub.partner_email_events where mailbox_id in (${DOOMED})`, [
    tenantId,
  ]);
  await tx.unsafe(
    `update hub.partner_mailbox p set prev_id = null where p.prev_id in (${DOOMED}) and p.id not in (${DOOMED})`,
    [tenantId],
  );
  out.mailboxDeleted = await count(
    tx,
    `delete from hub.partner_mailbox where id in (${DOOMED})`,
    tenantId,
  );
  // (3) Dòng còn lại: bên bị xoá → tombstone, xoá dữ liệu của nó (bản chia sẻ/tệp nếu là bên gửi; bằng chứng/lý do trả lời nếu là bên nhận).
  out.mailboxAnonymized += await count(
    tx,
    `update hub.partner_mailbox set from_tenant = ${X}, payload = '{}'::jsonb, from_ref = null, file_ref = null, pdf_sha256 = null,
       updated_at = now() where from_tenant = $1::uuid`,
    tenantId,
  );
  out.mailboxAnonymized += await count(
    tx,
    `update hub.partner_mailbox set to_tenant = ${X}, evidence = null, reason = null, token_hash = null, to_email = null,
       updated_at = now() where to_tenant = $1::uuid`,
    tenantId,
  );
  // (4) Liên kết: lời mời chưa chấp nhận / đầu kia đã xoá ⇒ xoá; còn lại ⇒ tombstone (trùng khoá chính với dòng tombstone sẵn có ⇒ xoá dòng trùng).
  out.linksDeleted = await count(
    tx,
    `delete from hub.partner_links l where (l.from_tenant = $1::uuid or l.to_tenant = $1::uuid)
       and (l.accepted_at is null or l.from_tenant = ${X} or l.to_tenant = ${X})`,
    tenantId,
  );
  out.linksDeleted += await count(
    tx,
    `delete from hub.partner_links l where (l.from_tenant = $1::uuid or l.to_tenant = $1::uuid) and exists (
       select 1 from hub.partner_links d where d.from_tenant = case when l.from_tenant = $1::uuid then ${X} else l.from_tenant end
         and d.to_tenant = case when l.to_tenant = $1::uuid then ${X} else l.to_tenant end)`,
    tenantId,
  );
  out.linksAnonymized = await count(
    tx,
    `update hub.partner_links l set from_tenant = case when l.from_tenant = $1::uuid then ${X} else l.from_tenant end,
       to_tenant = case when l.to_tenant = $1::uuid then ${X} else l.to_tenant end
     where l.from_tenant = $1::uuid or l.to_tenant = $1::uuid`,
    tenantId,
  );
  return out;
}
