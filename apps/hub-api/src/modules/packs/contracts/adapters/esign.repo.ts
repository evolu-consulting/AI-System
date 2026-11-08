// cf-esign-docusign · repo ký số trong tx `PackUow` (role `contracts_rw`, RLS tenant + M1 của `contracts`): HĐ + tệp + đối tác (vai
// `partner_role_of` + liên hệ đầu tiên có email), envelope mới nhất, cờ bật ở `approval_settings`. Lọc `tenant_id` tường minh ngoài
// RLS. `tenantOfEnvelope`: role `contracts_job` (chỉ đọc tenant_id, envelope_id) — map webhook ⇒ tenant.
import type { ESignStatus } from "@ai/contracts/pack-contracts";
import type { Db, Tx } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type {
  ContractForSign,
  EnvelopeRow,
  ESignRepo,
  StoredSigner,
} from "../application/esign.ports";
import { ESIGN_SWITCHING } from "../application/esign-switch";
import { contractNameSql } from "./contract-name.sql";

type Raw = {
  id: string;
  contract_id: string;
  provider: string;
  envelope_id: string;
  status: ESignStatus;
  signers: StoredSigner[];
  reason: string | null;
  signed_file_id: string | null;
  completed_at: string | null;
  created_at: string;
  sent_by: string;
  due_h: number | null;
  remind_every_h: number | null;
};
const COLS =
  sql.raw(`e.id, e.contract_id, e.provider, e.envelope_id, e.status, e.signers, e.reason, e.signed_file_id,
  to_char(e.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as completed_at,
  to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, e.sent_by, e.due_h, e.remind_every_h`);
const toRow = (r: Raw | undefined): EnvelopeRow | null =>
  r
    ? {
        id: r.id,
        contractId: r.contract_id,
        provider: r.provider,
        envelopeId: r.envelope_id,
        status: r.status,
        signers: r.signers,
        reason: r.reason,
        signedFileId: r.signed_file_id,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        sentBy: r.sent_by,
        dueH: r.due_h ?? null,
        remindEveryH: r.remind_every_h ?? null,
      }
    : null;

type CRaw = {
  id: string;
  title: string;
  number: string | null;
  locked: boolean;
  org: string | null;
  file_id: string | null;
  mime: string | null;
  name: string | null;
  partner_name: string | null;
  partner_email: string | null;
  has_partner: boolean;
};

type InviteRaw = {
  title: string;
  number: string | null;
  partner: string | null;
  value: string | null;
  start_d: string | null;
  end_d: string | null;
  owner: string | null;
  company: string | null;
  sent_at: string | null;
  due_at: string | null;
  th: boolean;
  file_row: string | null;
  org: string | null;
  file_id: string | null;
  mime: string | null;
};

const inviteCardOf = (r: InviteRaw) => {
  const num = r.value !== null && /^-?\d+(\.\d+)?$/.test(r.value) ? Number(r.value) : null;
  return {
    title: r.title,
    number: r.number,
    partner: r.partner,
    value: num,
    start: r.start_d,
    end: r.end_d,
    ownerId: r.owner,
    company: r.company,
    sentAt: r.sent_at,
    dueAt: r.due_at,
    thumbOn: r.th !== false,
    file:
      r.file_row && r.org && r.file_id
        ? { fileRow: r.file_row, org: r.org, fileId: r.file_id, mime: r.mime }
        : null,
  };
};

export function esignRepo(tx: Tx, t: string): ESignRepo {
  return {
    // CR-125 · x6 · người cần thấy thẻ ký số cập nhật ngay: người gửi + người ký công ty của phong bì mới nhất của HĐ (cùng tenant; MỘT câu).
    watchers: async (contractId) => {
      const [e] = await tx.execute<{
        sent_by: string;
        signers: { client_user_id?: string | null }[];
      }>(sql`select sent_by::text as sent_by, signers from contracts.esign_envelopes
        where tenant_id = ${t}::uuid and contract_id = ${contractId}::uuid
        order by created_at desc limit 1`);
      if (!e) return [];
      const ids = [
        e.sent_by,
        ...e.signers.flatMap((s) => (s.client_user_id ? [s.client_user_id] : [])),
      ];
      return [...new Set(ids)];
    },
    settings: async () => {
      const [r] = await tx.execute<{ on: boolean; dp: string | null; th: boolean }>(sql`select
          coalesce(s.esign_enabled, false) as on, s.esign_default_provider as dp,
          coalesce(s.esign_invite_thumbnail, true) as th
        from (select 1) one left join contracts.approval_settings s on s.tenant_id = ${t}::uuid`);
      return {
        enabled: r?.on === true,
        defaultProvider: r?.dp ?? null,
        inviteThumbnail: r?.th !== false,
      };
    },
    // esign-multi · vắng trường ⇒ giữ giá trị cũ (null ⇒ coalesce với cũ); audit before/after cả hai trường.
    saveSettings: async (p, actor) => {
      const en = p.enabled ?? null;
      const dp = p.defaultProvider ?? null;
      const th = p.inviteThumbnail ?? null;
      await tx.execute(sql`with old as (select coalesce(s.esign_enabled, false) as en, s.esign_default_provider as dp,
              coalesce(s.esign_invite_thumbnail, true) as th
            from (select 1) one left join contracts.approval_settings s on s.tenant_id = ${t}::uuid),
          up as (insert into contracts.approval_settings (tenant_id, esign_enabled, esign_default_provider, esign_invite_thumbnail, updated_by)
            values (${t}::uuid, coalesce(${en}::boolean, false), ${dp}::text, coalesce(${th}::boolean, true), ${actor}::uuid)
            on conflict (tenant_id) do update set
              esign_enabled = coalesce(${en}::boolean, contracts.approval_settings.esign_enabled),
              esign_default_provider = coalesce(${dp}::text, contracts.approval_settings.esign_default_provider),
              esign_invite_thumbnail = coalesce(${th}::boolean, contracts.approval_settings.esign_invite_thumbnail),
              updated_by = excluded.updated_by, updated_at = now()
            returning esign_enabled, esign_default_provider, esign_invite_thumbnail)
        insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
          select ${t}::uuid, ${actor}::uuid,
            (select jsonb_build_object('esign_enabled', en, 'esign_default_provider', dp, 'esign_invite_thumbnail', th) from old),
            jsonb_build_object('esign_enabled', up.esign_enabled, 'esign_default_provider', up.esign_default_provider,
              'esign_invite_thumbnail', up.esign_invite_thumbnail)
          from up`);
    },
    inviteCard: async (id) => {
      const [r] =
        await tx.execute<InviteRaw>(sql`select ${contractNameSql("c")} as title, c.number, p.name as partner,
          nullif(btrim(c.fields -> 'total_value' ->> 'value'), '') as value,
          nullif(btrim(c.fields -> 'start_date' ->> 'value'), '') as start_d,
          nullif(btrim(c.fields -> 'end_date' ->> 'value'), '') as end_d,
          c.owner_user_id::text as owner, (select s.name from hub.partner_self() s limit 1) as company,
          to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as sent_at,
          to_char((e.created_at + make_interval(hours => e.due_h)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as due_at,
          coalesce(st.esign_invite_thumbnail, true) as th,
          f.id::text as file_row, f.org, f.file_id, f.mime
        from contracts.contracts c
        left join contracts.files f on f.id = c.file_id and f.tenant_id = c.tenant_id and f.deleted_at is null
        left join lateral contracts.partner_role_of(c) p on true
        left join lateral (select x.created_at, x.due_h from contracts.esign_envelopes x
          where x.tenant_id = c.tenant_id and x.contract_id = c.id order by x.created_at desc, x.id desc limit 1) e on true
        left join contracts.approval_settings st on st.tenant_id = c.tenant_id
        where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid limit 1`);
      return r ? inviteCardOf(r) : null;
    },
    contract: async (id) => {
      const [r] =
        await tx.execute<CRaw>(sql`select c.id, ${contractNameSql("c")} as title, c.number, c.locked_at is not null as locked,
          f.org, f.file_id, f.mime, f.name, p.name as partner_name, pc.email as partner_email,
          p.party_key is not null as has_partner
        from contracts.contracts c
        left join contracts.files f on f.id = c.file_id and f.tenant_id = c.tenant_id and f.deleted_at is null
        left join lateral contracts.partner_role_of(c) p on true
        left join lateral (select x.name, x.email from contracts.partner_contacts x
          where x.tenant_id = c.tenant_id and x.party_key = p.party_key and x.email is not null
          order by x.sort, x.created_at, x.id limit 1) pc on true
        where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid limit 1`);
      return r ? contractOf(r) : null;
    },
    lockForSign: async (id, by, viaRun = false) => {
      await tx.execute(sql`update contracts.contracts c set locked_at = now(), locked_by = ${by}::uuid,
          version = c.version + 1, updated_at = now()
        where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid and c.locked_at is null
          and c.status = 'needs_review' and (c.run_id is not null or ${viaRun}::boolean)`);
      // CR-125 · cr125-contract-from-step: HĐ tạo từ bước quy trình («Tạo hợp đồng từ hồ sơ») chưa có hàng approvals của gói nhưng là bản ghi
      // CỦA LƯỢT đang chạy (`viaRun`, tool kiểm với hub) ⇒ vẫn khoá được. HĐ bất kỳ khác (không lượt duyệt, không phải bản ghi của lượt) ⇒ không khoá.
    },
    latest: async (contractId) => {
      const [r] = await tx.execute<Raw>(sql`select ${COLS} from contracts.esign_envelopes e
        where e.tenant_id = ${t}::uuid and e.contract_id = ${contractId}::uuid
        order by e.created_at desc, e.id desc limit 1`);
      return toRow(r);
    },
    byEnvelope: async (envelopeId) => {
      const [r] = await tx.execute<Raw>(sql`select ${COLS} from contracts.esign_envelopes e
        where e.tenant_id = ${t}::uuid and e.envelope_id = ${envelopeId}`);
      return toRow(r);
    },
    claimExpire: async (id, now, leaseMin) => {
      const at = now.toISOString();
      const [r] = await tx.execute<Raw>(sql`update contracts.esign_envelopes e
        set expire_claimed_at = ${at}::timestamptz
        where e.tenant_id = ${t}::uuid and e.id = ${id}::uuid and e.status in ('sent', 'delivered')
          and e.due_h is not null and e.created_at + make_interval(hours => e.due_h) <= ${at}::timestamptz
          and (e.expire_claimed_at is null
            or e.expire_claimed_at <= ${at}::timestamptz - make_interval(mins => ${leaseMin}::int))
        returning ${COLS}`);
      return toRow(r);
    },
    lockById: async (id) => {
      const [r] = await tx.execute<Raw>(sql`select ${COLS} from contracts.esign_envelopes e
        where e.tenant_id = ${t}::uuid and e.id = ${id}::uuid for update`);
      return toRow(r);
    },
    claimSwitch: async (id, now, leaseMin) => {
      const at = now.toISOString();
      const [r] = await tx.execute<Raw>(sql`update contracts.esign_envelopes e
        set expire_claimed_at = ${at}::timestamptz, reason = ${ESIGN_SWITCHING}
        where e.tenant_id = ${t}::uuid and e.id = ${id}::uuid and e.status in ('sent', 'delivered')
          and (e.reason is null or e.reason = ${ESIGN_SWITCHING})
          and not exists (select 1 from jsonb_array_elements(e.signers) s
            where coalesce(s->>'signed_at', '') <> '')
          and (e.expire_claimed_at is null
            or e.expire_claimed_at <= ${at}::timestamptz - make_interval(mins => ${leaseMin}::int))
        returning ${COLS}`);
      return toRow(r);
    },
    releaseSwitch: async (id) => {
      await tx.execute(sql`update contracts.esign_envelopes set expire_claimed_at = null, reason = null
        where tenant_id = ${t}::uuid and id = ${id}::uuid and status in ('sent', 'delivered')
          and reason = ${ESIGN_SWITCHING}`);
    },
    // CR-125 · m10 · cập nhật từ webhook/đồng bộ CHỈ khi hàng còn đúng trạng thái đã đọc, không đang bị đổi cách ký (lease còn hạn) và là
    // phong bì MỚI NHẤT của HĐ — phong bì cũ đã bị thay không còn được rẽ nhánh lượt.
    syncUpdate: async (envelopeId, expect, p, leaseMin) => {
      const rows =
        await tx.execute(sql`update contracts.esign_envelopes e set status = ${p.status}, reason = ${p.reason},
          completed_at = ${p.completedAt}::timestamptz, signers = ${JSON.stringify(p.signers)}::jsonb, updated_at = now()
        where e.tenant_id = ${t}::uuid and e.envelope_id = ${envelopeId} and e.status = ${expect}
          and not (e.reason is not distinct from ${ESIGN_SWITCHING}
            and e.expire_claimed_at > now() - make_interval(mins => ${leaseMin}::int))
          and not exists (select 1 from contracts.esign_envelopes n where n.tenant_id = e.tenant_id
            and n.contract_id = e.contract_id and (n.created_at, n.id) > (e.created_at, e.id))
        returning e.id`);
      return rows.length === 1;
    },
    voidClaimed: async (id, reason) => {
      const rows = await tx.execute(sql`update contracts.esign_envelopes
        set status = 'voided', reason = ${reason}, completed_at = null, updated_at = now()
        where tenant_id = ${t}::uuid and id = ${id}::uuid and status in ('sent', 'delivered') returning id`);
      return rows.length === 1;
    },
    audit: async (actor, before, after) => {
      // CR-125 · đổi nhà cung cấp ký giữa chừng: ngoài audit cấu hình, còn một dòng ở lịch sử HĐ (ai · từ nhà cung cấp nào sang nào).
      const sw = (after as { esign_switch?: { contract_id?: string; provider?: string } })
        .esign_switch;
      const from =
        (before as { esign_switch?: { provider?: string } }).esign_switch?.provider ?? null;
      await tx.execute(sql`with a as (insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
          values (${t}::uuid, ${actor}::uuid, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb)),
        ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, c.id, 'esign_switched', ${actor}::uuid,
            jsonb_strip_nulls(jsonb_build_object('from', ${from}::text, 'to', ${sw?.provider ?? null}::text))
          from contracts.contracts c where c.id::text = ${sw?.contract_id ?? null}::text and c.tenant_id = ${t}::uuid)
        select 1`);
    },
    insert: async (r) => {
      // CR-125 · gửi ký ⇒ một dòng lịch sử HĐ (người gửi, nhà cung cấp, danh sách người ký) cùng câu với phong bì.
      const rows = await tx.execute(sql`with i as (insert into contracts.esign_envelopes
            (tenant_id, contract_id, provider, envelope_id, signers, sent_by, due_h, remind_every_h)
          values (${t}::uuid, ${r.contractId}::uuid, ${r.provider}, ${r.envelopeId}, ${JSON.stringify(r.signers)}::jsonb,
            ${r.sentBy}::uuid, ${r.dueH ?? null}::int, ${r.remindEveryH ?? null}::int)
          on conflict (tenant_id, contract_id) where status in ('sent', 'delivered') do nothing returning id, contract_id),
        ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, i.contract_id, 'esign_sent', ${r.sentBy}::uuid,
            jsonb_build_object('provider', ${r.provider}::text,
              'signers', (select coalesce(jsonb_agg(jsonb_build_object('role', s ->> 'role', 'name', s ->> 'name')), '[]'::jsonb)
                from jsonb_array_elements(${JSON.stringify(r.signers)}::jsonb) s))
          from i)
        select id from i`);
      return rows.length === 1;
    },
    update: async (envelopeId, p) => {
      // CR-125 · phong bì sang trạng thái cuối (đã ký / từ chối / huỷ / hết hạn) ⇒ MỘT dòng lịch sử HĐ (kèm ai đã ký lúc nào); gọi lại
      // cùng trạng thái ⇒ không ghi đôi (so với trạng thái trước câu này).
      // Review · hai webhook giống hệt chạy song song: KHOÁ hàng và đọc trạng thái trước ở câu riêng (CTE `for update` cùng câu với UPDATE
      // không thấy hàng đã bị chính câu sửa); câu thứ hai chờ khoá rồi đọc bản mới ⇒ không ghi dòng thứ hai. Cùng tx ⇒ khoá giữ tới commit.
      const [pv] = await tx.execute<{
        status: string;
      }>(sql`select status from contracts.esign_envelopes
        where tenant_id = ${t}::uuid and envelope_id = ${envelopeId} for update`);
      const prev = pv?.status ?? null;
      await tx.execute(sql`with        u as (update contracts.esign_envelopes set status = ${p.status}, reason = ${p.reason},
            completed_at = ${p.completedAt}::timestamptz, signers = ${JSON.stringify(p.signers)}::jsonb, updated_at = now()
          where tenant_id = ${t}::uuid and envelope_id = ${envelopeId} returning contract_id, status, reason, signers),
        ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, u.contract_id,
            case u.status when 'completed' then 'esign_signed' when 'declined' then 'esign_declined'
              when 'voided' then 'esign_voided' else 'esign_expired' end,
            null,
            jsonb_strip_nulls(jsonb_build_object('reason', u.reason,
              'signers', (select coalesce(jsonb_agg(jsonb_build_object('role', s ->> 'role', 'name', s ->> 'name',
                'signed_at', s ->> 'signed_at')), '[]'::jsonb) from jsonb_array_elements(u.signers) s)))
          from u
          where u.status in ('completed', 'declined', 'voided', 'expired')
            and ${prev}::text is distinct from u.status)
        select 1`);
    },
    attachSigned: async (envelopeId, f) => {
      const [lock] = await tx.execute<{ has: boolean }>(sql`select signed_file_id is not null as has
        from contracts.esign_envelopes where tenant_id = ${t}::uuid and envelope_id = ${envelopeId} for update`);
      if (!lock || lock.has) return false;
      await tx.execute(sql`insert into contracts.files
          (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
        values (${f.id}::uuid, ${t}::uuid, ${f.org}, ${f.fileId}, ${f.versionId}, ${f.name}, 'application/pdf',
          ${f.sizeBytes}, ${f.createdBy}::uuid)`);
      await tx.execute(sql`update contracts.esign_envelopes set signed_file_id = ${f.id}::uuid, updated_at = now()
        where tenant_id = ${t}::uuid and envelope_id = ${envelopeId}`);
      return true;
    },
    signedFile: async (contractId) => {
      const [r] = await tx.execute<{ org: string; file_id: string }>(sql`select f.org, f.file_id
        from contracts.esign_envelopes e join contracts.files f on f.id = e.signed_file_id and f.tenant_id = e.tenant_id
        where e.tenant_id = ${t}::uuid and e.contract_id = ${contractId}::uuid and f.deleted_at is null
        order by e.created_at desc limit 1`);
      return r ? { org: r.org, fileId: r.file_id } : null;
    },
  };
}

function contractOf(r: CRaw): ContractForSign {
  return {
    id: r.id,
    title: r.title,
    number: r.number,
    locked: r.locked,
    file:
      r.org && r.file_id
        ? { org: r.org, fileId: r.file_id, mime: r.mime ?? "", name: r.name ?? "hd.pdf" }
        : null,
    partner: r.has_partner ? { name: r.partner_name, email: r.partner_email } : null,
  };
}

/** Webhook: envelope ⇒ tenant (role `contracts_job`, không đọc gì khác). */
export const tenantOfEnvelope =
  (db: Db) =>
  async (provider: string, envelopeId: string): Promise<string | null> => {
    const rows = await withPackJobScope(db, "contracts", (tx) =>
      tx.execute<{ tenant_id: string }>(sql`select tenant_id from contracts.esign_envelopes
        where provider = ${provider} and envelope_id = ${envelopeId} limit 1`),
    );
    return rows[0]?.tenant_id ?? null;
  };
