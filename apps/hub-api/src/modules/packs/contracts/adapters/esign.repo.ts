// cf-esign-docusign · repo ký số trong tx `PackUow` (role `contracts_rw`, RLS tenant + M1 của `contracts`): HĐ + tệp + đối tác (vai
// `partner_role_of` + liên hệ đầu tiên có email), envelope mới nhất, cờ bật ở `approval_settings`. Lọc `tenant_id` tường minh ngoài
// RLS. `tenantOfEnvelope`: role `contracts_job` (chỉ đọc tenant_id, envelope_id) — map webhook ⇒ tenant.
import type { ESignStatus } from "@ai/contracts";
import type { Db, Tx } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type {
  ContractForSign,
  EnvelopeRow,
  ESignRepo,
  StoredSigner,
} from "../application/esign.ports";

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
};
const COLS =
  sql.raw(`e.id, e.contract_id, e.provider, e.envelope_id, e.status, e.signers, e.reason, e.signed_file_id,
  to_char(e.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as completed_at,
  to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, e.sent_by`);
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

export function esignRepo(tx: Tx, t: string): ESignRepo {
  return {
    settings: async () => {
      const [r] = await tx.execute<{ on: boolean; dp: string | null }>(sql`select
          coalesce(s.esign_enabled, false) as on, s.esign_default_provider as dp
        from (select 1) one left join contracts.approval_settings s on s.tenant_id = ${t}::uuid`);
      return { enabled: r?.on === true, defaultProvider: r?.dp ?? null };
    },
    // esign-multi · vắng trường ⇒ giữ giá trị cũ (null ⇒ coalesce với cũ); audit before/after cả hai trường.
    saveSettings: async (p, actor) => {
      const en = p.enabled ?? null;
      const dp = p.defaultProvider ?? null;
      await tx.execute(sql`with old as (select coalesce(s.esign_enabled, false) as en, s.esign_default_provider as dp
            from (select 1) one left join contracts.approval_settings s on s.tenant_id = ${t}::uuid),
          up as (insert into contracts.approval_settings (tenant_id, esign_enabled, esign_default_provider, updated_by)
            values (${t}::uuid, coalesce(${en}::boolean, false), ${dp}::text, ${actor}::uuid)
            on conflict (tenant_id) do update set
              esign_enabled = coalesce(${en}::boolean, contracts.approval_settings.esign_enabled),
              esign_default_provider = coalesce(${dp}::text, contracts.approval_settings.esign_default_provider),
              updated_by = excluded.updated_by, updated_at = now()
            returning esign_enabled, esign_default_provider)
        insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
          select ${t}::uuid, ${actor}::uuid,
            (select jsonb_build_object('esign_enabled', en, 'esign_default_provider', dp) from old),
            jsonb_build_object('esign_enabled', up.esign_enabled, 'esign_default_provider', up.esign_default_provider)
          from up`);
    },
    contract: async (id) => {
      const [r] =
        await tx.execute<CRaw>(sql`select c.id, c.title, c.number, c.locked_at is not null as locked,
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
    insert: async (r) => {
      const rows = await tx.execute(sql`insert into contracts.esign_envelopes
          (tenant_id, contract_id, provider, envelope_id, signers, sent_by)
        values (${t}::uuid, ${r.contractId}::uuid, ${r.provider}, ${r.envelopeId}, ${JSON.stringify(r.signers)}::jsonb,
          ${r.sentBy}::uuid)
        on conflict (tenant_id, contract_id) where status in ('sent', 'delivered') do nothing returning id`);
      return rows.length === 1;
    },
    update: async (envelopeId, p) => {
      await tx.execute(sql`update contracts.esign_envelopes set status = ${p.status}, reason = ${p.reason},
          completed_at = ${p.completedAt}::timestamptz, signers = ${JSON.stringify(p.signers)}::jsonb, updated_at = now()
        where tenant_id = ${t}::uuid and envelope_id = ${envelopeId}`);
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
