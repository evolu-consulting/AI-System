// tool-tenant-purge · hộp thư đối tác hai bên (hub.partner_mailbox / partner_links / partner_email_events / partner_sign_sessions): GIỮ lịch sử của công ty còn lại
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
  pmsgThreadsDeleted: number;
  pmsgThreadsMerged: number;
  pmsgThreadsAnonymized: number;
  pmsgMessagesAnonymized: number;
};
export const NO_PARTNER: PartnerStats = {
  mailboxDeleted: 0,
  mailboxAnonymized: 0,
  linksDeleted: 0,
  linksAnonymized: 0,
  copiesAnonymized: 0,
  pmsgThreadsDeleted: 0,
  pmsgThreadsMerged: 0,
  pmsgThreadsAnonymized: 0,
  pmsgMessagesAnonymized: 0,
};

const X = `'${PARTNER_DELETED_TENANT_ID}'::uuid`;
/** Bên còn lại của dòng hộp thư đối với tenant `$1`. */
const OTHER = "(case when m.from_tenant = $1::uuid then m.to_tenant else m.from_tenant end)";
/**
 * Dòng hộp thư phải XOÁ (không còn bên nào giữ lịch sử). Lần gửi chưa giao (held/sent) chỉ xoá khi bên kia CHƯA có bản sao
 * (`copies` = điều kiện NOT EXISTS trên partner_inbox/partner_sends của tenant khác): có bản sao ⇒ giữ dòng (ẩn danh) để bản sao còn mailbox_id hợp lệ.
 */
const doomed = (copies: string): string => `select m.id from hub.partner_mailbox m
  where (m.from_tenant = $1::uuid or m.to_tenant = $1::uuid)
  and (${OTHER} is null or ${OTHER} = ${X} or (m.from_tenant = $1::uuid and m.status in ('held', 'sent')${copies}))`;
const count = async (tx: Tx, text: string, tid: string): Promise<number> =>
  (await tx.unsafe(text, [tid])).count;
const has = async (tx: Tx, rel: string): Promise<boolean> =>
  (
    (await tx.unsafe("select to_regclass($1) is not null as ok", [rel])) as unknown as {
      ok: boolean;
    }[]
  )[0]?.ok === true;

/**
 * Tên bên bị xoá còn nằm ở dữ liệu KHÁC của công ty còn lại, suy ra từ bản sao (contracts.partner_inbox.sender_name / partner_sends.to_name):
 * tiêu đề HĐ nhận («Hợp đồng từ <tên>»), lịch sử HĐ (contract_events.data), chuông (hub.notifications). Thay bằng «Công ty đã xoá», theo tập
 * (một bảng tạm + 3 câu), chỉ trong tenant và HĐ của bản sao. admin.audit_log KHÔNG sửa (append-only; đường đối tác không ghi tên vào đó).
 */
async function scrubNames(tx: Tx, tenantId: string, inbox: boolean, sends: boolean): Promise<void> {
  const parts = [
    inbox &&
      `select i.tenant_id, i.contract_id, i.sender_name as old from contracts.partner_inbox i
       where i.tenant_id <> $1::uuid and i.mailbox_id in (select m.id from hub.partner_mailbox m where m.from_tenant = $1::uuid)`,
    sends &&
      `select s.tenant_id, s.contract_id, s.to_name from contracts.partner_sends s
       where s.tenant_id <> $1::uuid and s.mailbox_id in (select m.id from hub.partner_mailbox m where m.to_tenant = $1::uuid)`,
  ].filter(Boolean);
  await tx.unsafe("drop table if exists pg_temp._purge_names");
  await tx.unsafe(
    `create temp table _purge_names on commit drop as
     select distinct x.tenant_id, x.contract_id, x.old from (${parts.join(" union all ")}) x
     where x.old is not null and x.old <> '' and x.old <> '${PARTNER_DELETED_NAME}'`,
    [tenantId],
  );
  await tx.unsafe(
    `update contracts.contracts c set title = replace(c.title, n.old, '${PARTNER_DELETED_NAME}')
     from _purge_names n where c.tenant_id = n.tenant_id and c.id = n.contract_id and strpos(c.title, n.old) > 0`,
  );
  // jsonb: so khớp trên bản văn JSON (tên thoát ký tự như trong data::text).
  await tx.unsafe(
    `update contracts.contract_events e set data = replace(e.data::text, substr(to_jsonb(n.old)::text, 2, length(to_jsonb(n.old)::text) - 2),
         '${PARTNER_DELETED_NAME}')::jsonb
     from _purge_names n where e.tenant_id = n.tenant_id and e.contract_id = n.contract_id
       and strpos(e.data::text, substr(to_jsonb(n.old)::text, 2, length(to_jsonb(n.old)::text) - 2)) > 0`,
  );
  await tx.unsafe(
    `update hub.notifications b set title = replace(b.title, n.old, '${PARTNER_DELETED_NAME}'), body = replace(b.body, n.old, '${PARTNER_DELETED_NAME}')
     from (select distinct tenant_id, old from _purge_names) n
     where b.tenant_id = n.tenant_id and (strpos(b.title, n.old) > 0 or strpos(b.body, n.old) > 0)`,
  );
}
/** Ẩn danh bên `tenantId` trong dữ liệu đối tác của các tenant khác; xoá dòng không còn ai giữ lịch sử. */
export async function anonymizePartner(tx: Tx, tenantId: string): Promise<PartnerStats> {
  if (!(await has(tx, "hub.partner_mailbox"))) return NO_PARTNER;
  const out = { ...NO_PARTNER };
  const hasInbox = await has(tx, "contracts.partner_inbox");
  const hasSends = await has(tx, "contracts.partner_sends");
  const copies =
    (hasInbox
      ? " and not exists (select 1 from contracts.partner_inbox i where i.mailbox_id = m.id and i.tenant_id <> $1::uuid)"
      : "") +
    (hasSends
      ? " and not exists (select 1 from contracts.partner_sends s where s.mailbox_id = m.id and s.tenant_id <> $1::uuid)"
      : "");
  const DOOMED = doomed(copies);
  if (hasInbox || hasSends) await scrubNames(tx, tenantId, hasInbox, hasSends);
  await anonymizeCopies(tx, tenantId, out, { hasInbox, hasSends });
  await deleteDoomed(tx, tenantId, out, DOOMED);
  await anonymizeMailbox(tx, tenantId, out);
  await anonymizeLinks(tx, tenantId, out);
  await purgePartnerMessages(tx, tenantId, out);
  return out;
}

async function anonymizeCopies(
  tx: Tx,
  tenantId: string,
  out: PartnerStats,
  has: { hasInbox: boolean; hasSends: boolean },
): Promise<void> {
  const { hasInbox, hasSends } = has;
  // (1) Bản sao phía bên kia (gói contracts, tenant_id ≠ tenant bị xoá): tên/MST/bản chia sẻ của bên bị xoá.
  if (hasInbox)
    out.copiesAnonymized += await count(
      tx,
      `update contracts.partner_inbox i set sender_name = '${PARTNER_DELETED_NAME}', sender_tax_code = null, sender_verified = false,
         shared = '{}'::jsonb, message = null, file_ref = null, pdf_sha256 = null
       where i.tenant_id <> $1::uuid and i.mailbox_id in (select m.id from hub.partner_mailbox m where m.from_tenant = $1::uuid)`,
      tenantId,
    );
  if (hasSends)
    out.copiesAnonymized += await count(
      tx,
      `update contracts.partner_sends s set to_name = '${PARTNER_DELETED_NAME}', to_key = '${PARTNER_DELETED_KEY}'
       where s.tenant_id <> $1::uuid and s.mailbox_id in (select m.id from hub.partner_mailbox m where m.to_tenant = $1::uuid)`,
      tenantId,
    );
}

async function deleteDoomed(
  tx: Tx,
  tenantId: string,
  out: PartnerStats,
  DOOMED: string,
): Promise<void> {
  // (2) Hộp thư: xoá dòng không còn ai giữ (nhật ký email + phiên ký chung trước, rồi dòng; thread tham chiếu `prev_id` sang dòng bị xoá ⇒ NULL).
  await tx.unsafe(`delete from hub.partner_email_events where mailbox_id in (${DOOMED})`, [
    tenantId,
  ]);
  // CR-127 (hub 0132): phiên ký chung gắn FK vào hộp thư ⇒ xoá cùng dòng hộp thư bị xoá.
  if (await has(tx, "hub.partner_sign_sessions"))
    await tx.unsafe(`delete from hub.partner_sign_sessions where mailbox_id in (${DOOMED})`, [
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
}

async function anonymizeMailbox(tx: Tx, tenantId: string, out: PartnerStats): Promise<void> {
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
  await anonymizeSignSessions(tx, tenantId);
}

/**
 * CR-127 (hub 0132) · phiên ký chung hai bên (hub.partner_sign_sessions, không có tenant_id): bên bị xoá → tombstone, xoá tên người ký +
 * lý do của nó (bên gửi: lý do đề xuất; huỷ phía nó: lý do huỷ). `pdf_sha256` GIỮ (mã băm không phải PII, là bằng chứng văn bản ký chung của công ty còn lại). Dòng còn đủ hai bên mới tới đây — dòng
 * có bên kia đã xoá bị xoá ở `deleteDoomed` (nên `from_tenant <> to_tenant` không vỡ).
 */
async function anonymizeSignSessions(tx: Tx, tenantId: string): Promise<void> {
  if (!(await has(tx, "hub.partner_sign_sessions"))) return;
  await tx.unsafe(
    `update hub.partner_sign_sessions set from_tenant = ${X}, from_signer_name = null, reason = null,
       cancel_reason = case when cancel_side = 'from' then null else cancel_reason end, updated_at = now()
     where from_tenant = $1::uuid`,
    [tenantId],
  );
  await tx.unsafe(
    `update hub.partner_sign_sessions set to_tenant = ${X}, to_signer_name = null,
       cancel_reason = case when cancel_side = 'to' then null else cancel_reason end, updated_at = now()
     where to_tenant = $1::uuid`,
    [tenantId],
  );
}

async function anonymizeLinks(tx: Tx, tenantId: string, out: PartnerStats): Promise<void> {
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
}

/**
 * CR-169 (hub 0149) · nhắn tin người–người giữa hai công ty (hub.pmsg_threads / pmsg_messages — không có tenant_id; pmsg_files có ⇒ xoá theo
 * tenant_id ở bước sau, kể cả id FileBox `box_file_id` — `tenantFileIds` đọc trước khi xoá). Luật đã chốt: GIỮ lịch sử cho công ty còn lại (B),
 * ẩn danh người của A (tenant + user → tombstone `X`, một uuid cố định cho cả công ty): tin của A GIỮ chữ, người gửi → X, bỏ tệp đính kèm
 * (byte đã xoá ở kho), `client_id` đổi mới; mốc đọc của A về 0. Thread bên kia cũng đã xoá ⇒ xoá thread (cascade tin/tệp). Khoá thread duy nhất
 * theo cặp ⇒ nhiều thread (A1,B1), (A2,B1) (hoặc đã có (X,B1) từ lần xoá trước) GỘP vào một thread đích: dời seq tin/tệp của nguồn theo
 * `last_seq` đích cộng dồn, mốc đọc của B dời theo (0 giữ nguyên), rồi xoá thread nguồn. Tất cả theo tập (kế hoạch = một bảng tạm). Idempotent.
 * Chuông `cc.*` (lời mời/đồng ý kết nối) còn nhắc tên A ⇒ `scrubChatBells`.
 */
async function purgePartnerMessages(tx: Tx, tenantId: string, out: PartnerStats): Promise<void> {
  if (!(await has(tx, "hub.pmsg_threads"))) return;
  const mine = "(t.a_tenant = $1::uuid or t.b_tenant = $1::uuid)";
  // Bên kia đã xoá (tombstone) ⇒ không còn ai giữ: xoá thread (cascade tin + tệp).
  out.pmsgThreadsDeleted = await count(
    tx,
    `delete from hub.pmsg_threads t where ${mine} and (t.a_tenant = ${X} or t.b_tenant = ${X})`,
    tenantId,
  );
  out.pmsgMessagesAnonymized = await count(
    tx,
    `update hub.pmsg_messages m set sender_user = ${X}, files = '[]'::jsonb, client_id = gen_random_uuid()
     from hub.pmsg_threads t where m.thread_id = t.id
       and ((t.a_tenant = $1::uuid and m.sender_user = t.a_user) or (t.b_tenant = $1::uuid and m.sender_user = t.b_user))`,
    tenantId,
  );
  await scrubChatBells(tx, tenantId);
  // Kế hoạch gộp: đích = thread (X, người kia) đã có, nếu không thì thread nguồn nhỏ nhất của nhóm (giữ tại chỗ, off = 0).
  await tx.unsafe("drop table if exists pg_temp._pmsg_plan");
  await tx.unsafe(
    `create temp table _pmsg_plan on commit drop as
     with src as (select t.id, t.last_seq, t.last_at,
         case when t.a_tenant = $1::uuid then t.b_tenant else t.a_tenant end as ot,
         case when t.a_tenant = $1::uuid then t.b_user else t.a_user end as ou,
         case when t.a_tenant = $1::uuid then t.b_read_seq else t.a_read_seq end as oread
       from hub.pmsg_threads t where ${mine}),
     dst as (select d.id, d.last_seq,
         case when d.a_tenant = ${X} then d.b_tenant else d.a_tenant end as ot,
         case when d.a_tenant = ${X} then d.b_user else d.a_user end as ou
       from hub.pmsg_threads d where d.a_tenant = ${X} or d.b_tenant = ${X}),
     g as (select s.*, x.id as xid, coalesce(x.last_seq, 0) as base,
         row_number() over (partition by s.ot, s.ou order by s.id) as rn,
         first_value(s.id) over (partition by s.ot, s.ou order by s.id) as first_id,
         coalesce(sum(s.last_seq) over (partition by s.ot, s.ou order by s.id rows between unbounded preceding and 1 preceding), 0) as prior
       from src s left join dst x on x.ot = s.ot and x.ou = s.ou)
     select id as sid, coalesce(xid, first_id) as did,
       case when xid is null and rn = 1 then 0 else base + prior end as off,
       last_seq as sn, last_at as sat, ot, ou, oread, (${X}, ${X}) < (ot, ou) as lt from g`,
    [tenantId],
  );
  const moved = "from _pmsg_plan p where p.sid <> p.did";
  await tx.unsafe(
    `update hub.pmsg_messages m set thread_id = p.did, seq = m.seq + p.off ${moved} and m.thread_id = p.sid`,
  );
  await tx.unsafe(
    `update hub.pmsg_files f set thread_id = p.did, seq = case when f.seq is null then null else f.seq + p.off end ${moved} and f.thread_id = p.sid`,
  );
  // Đích: cộng last_seq/last_at của các nguồn dời vào; mốc đọc của B (cạnh không phải A/tombstone): 0 giữ, >0 dời theo off.
  out.pmsgThreadsMerged = await count(
    tx,
    `update hub.pmsg_threads d set last_seq = d.last_seq + a.sn, last_at = greatest(d.last_at, a.sat),
       a_read_seq = case when d.a_tenant not in ($1::uuid, ${X}) then greatest(d.a_read_seq, a.rd) else d.a_read_seq end,
       b_read_seq = case when d.a_tenant in ($1::uuid, ${X}) then greatest(d.b_read_seq, a.rd) else d.b_read_seq end
     from (select did, sum(sn) as sn, max(sat) as sat, max(case when oread = 0 then 0 else oread + off end) as rd
           ${moved} group by did) a where d.id = a.did`,
    tenantId,
  );
  await tx.unsafe(
    "delete from hub.pmsg_threads t using _pmsg_plan p where t.id = p.sid and p.sid <> p.did",
  );
  // Thread còn lại: A → tombstone (giữ thứ tự khoá (a) < (b)), mốc đọc của A về 0, mốc của B theo bên mới.
  out.pmsgThreadsAnonymized = await count(
    tx,
    `update hub.pmsg_threads t set
       a_tenant = case when p.lt then ${X} else p.ot end, a_user = case when p.lt then ${X} else p.ou end,
       b_tenant = case when p.lt then p.ot else ${X} end, b_user = case when p.lt then p.ou else ${X} end,
       a_read_seq = case when p.lt then 0 else (case when t.a_tenant = $1::uuid then t.b_read_seq else t.a_read_seq end) end, b_read_seq = case when p.lt then (case when t.a_tenant = $1::uuid then t.b_read_seq else t.a_read_seq end) else 0 end
     from _pmsg_plan p
     where t.id = p.sid and p.sid = p.did`,
    tenantId,
  );
}

/** Chuông `cc.*` (hub.cc_bell / cc_send) của công ty khác nhắc tên bên bị xoá (tên hoặc tên pháp lý) ⇒ «Công ty đã xoá»; link bỏ tham số tên/tenant. */
async function scrubChatBells(tx: Tx, tenantId: string): Promise<void> {
  const rows = (await tx.unsafe(
    "select t.name, t.legal_name from admin.tenants t where t.id = $1::uuid",
    [tenantId],
  )) as unknown as { name: string | null; legal_name: string | null }[];
  const names = [...new Set([rows[0]?.legal_name, rows[0]?.name].filter((n): n is string => !!n))];
  const link = "'/contracts/partners'";
  for (const name of names)
    await tx.unsafe(
      `update hub.notifications n set title = replace(n.title, $2::text, '${PARTNER_DELETED_NAME}'),
         body = replace(n.body, $2::text, '${PARTNER_DELETED_NAME}'),
         link = case when n.link like '%tenant=' || $1::uuid::text || '%' or n.link like '%party=' || hub.cc_urlenc($2::text) || '%' then ${link} else n.link end
       where n.kind like 'cc.%' and n.tenant_id <> $1::uuid
         and (strpos(n.title, $2::text) > 0 or strpos(n.body, $2::text) > 0
              or n.link like '%tenant=' || $1::uuid::text || '%' or n.link like '%party=' || hub.cc_urlenc($2::text) || '%')`,
      [tenantId, name],
    );
}
