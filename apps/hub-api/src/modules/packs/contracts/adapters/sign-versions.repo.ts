// CR-181 · bản đã ký (`contracts.sign_versions`) + dấu chữ ký (`contracts.sign_marks`). Tệp gốc không bị sửa: mỗi lần Lưu thêm một bản (seq tăng dần).
// Thêm bản = 2 câu cố định: (1) khoá hàng `sign_docs` FOR UPDATE; (2) CTE chèn bản (seq = max+1) + mọi dấu từ MỘT tham số JSON. Câu (2) bắt đầu SAU khi
// có khoá ⇒ snapshot mới, thấy bản của tx đua trước ⇒ seq không trùng (khoá giữ tới hết tx của use case).
import type { SignatureKind, SignParts, SignPlacement } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type SignVersionRow = {
  id: string;
  file_id: string;
  seq: number;
  out_file_id: string;
  sha256: string;
  signed_by: string;
  signature_kind: SignatureKind;
  run_id: string | null;
  created_at: Date;
  voided_at: Date | null;
};

export type SignMarkRow = {
  id: string;
  signer_id: string;
  field_id: string | null;
  placement: SignPlacement;
  parts: SignParts;
  user_signature_id: string;
  caption: string | null;
  created_at: string;
};

export type SignVersionWithMarks = SignVersionRow & { marks: SignMarkRow[] };

export type NewSignMark = {
  fieldId: string | null;
  placement: SignPlacement;
  parts: SignParts;
  userSignatureId: string;
  caption: string | null;
};

export type NewSignVersion = {
  id: string;
  contractId: string;
  fileId: string;
  outFileId: string;
  sha256: string;
  signedBy: string;
  kind: SignatureKind;
  runId: string | null;
  marks: readonly NewSignMark[];
};

export type SignVersionsRepo = ReturnType<typeof signVersionsRepo>;

/** Số bản tối đa trả về mỗi tệp (trần an toàn; chuỗi bản thực tế ngắn). */
export const SIGN_VERSIONS_LIST_MAX = 200;

export function signVersionsRepo(tx: Tx, tenantId: string) {
  return {
    /** Thêm bản kế tiếp của tệp + dấu (một tx của use case). Tệp chưa có `sign_docs` ⇒ null. */
    add: async (v: NewSignVersion): Promise<{ id: string; seq: number } | null> => {
      const [lock] = await tx.execute<{ file_id: string }>(sql`
        select file_id from contracts.sign_docs
        where contract_id = ${v.contractId}::uuid and file_id = ${v.fileId}::uuid and tenant_id = ${tenantId}::uuid
        for update`);
      if (!lock) return null;
      const marks = JSON.stringify(
        v.marks.map((m) => ({
          field_id: m.fieldId,
          placement: m.placement,
          parts: m.parts,
          user_signature_id: m.userSignatureId,
          caption: m.caption,
        })),
      );
      const [r] = await tx.execute<{ id: string; seq: number }>(sql`
        with s as (
          select coalesce(max(seq), 0) + 1 as n from contracts.sign_versions
          where contract_id = ${v.contractId}::uuid and file_id = ${v.fileId}::uuid and tenant_id = ${tenantId}::uuid),
        i as (
          insert into contracts.sign_versions (id, tenant_id, contract_id, file_id, seq, out_file_id, sha256, signed_by, signature_kind, run_id)
          select ${v.id}::uuid, ${tenantId}::uuid, ${v.contractId}::uuid, ${v.fileId}::uuid, s.n, ${v.outFileId}::uuid, ${v.sha256},
            ${v.signedBy}::uuid, ${v.kind}, ${v.runId}::uuid from s
          returning id, seq),
        m as (
          insert into contracts.sign_marks (tenant_id, version_id, signer_id, field_id, placement, parts, user_signature_id, caption)
          select ${tenantId}::uuid, i.id, ${v.signedBy}::uuid, x.field_id, x.placement, x.parts, x.user_signature_id, x.caption
          from i, jsonb_to_recordset(${marks}::jsonb)
            as x(field_id uuid, placement text, parts jsonb, user_signature_id uuid, caption text)
          returning id)
        select i.id, i.seq from i`);
      return r ?? null;
    },
    /** Bản mới nhất chưa void của một tệp. */
    latest: async (contractId: string, fileId: string): Promise<SignVersionRow | null> => {
      const [r] = await tx.execute<SignVersionRow>(sql`
        select v.id, v.file_id, v.seq, v.out_file_id, v.sha256, v.signed_by, v.signature_kind, v.run_id, v.created_at, v.voided_at
        from contracts.sign_versions v
        where v.contract_id = ${contractId}::uuid and v.file_id = ${fileId}::uuid and v.tenant_id = ${tenantId}::uuid
          and v.voided_at is null
        order by v.seq desc limit 1`);
      return r ?? null;
    },
    /** Bản mới nhất chưa void của MỖI tệp trong HĐ (một câu). */
    latestByContract: (contractId: string) =>
      tx.execute<SignVersionRow>(sql`
        select distinct on (v.file_id) v.id, v.file_id, v.seq, v.out_file_id, v.sha256, v.signed_by, v.signature_kind, v.run_id,
          v.created_at, v.voided_at
        from contracts.sign_versions v
        where v.contract_id = ${contractId}::uuid and v.tenant_id = ${tenantId}::uuid and v.voided_at is null
        order by v.file_id, v.seq desc`),
    /** Mọi bản của tệp (kể cả đã void — lịch sử) kèm dấu, seq tăng dần. */
    list: (contractId: string, fileId: string) =>
      tx.execute<SignVersionWithMarks>(sql`
        select v.id, v.file_id, v.seq, v.out_file_id, v.sha256, v.signed_by, v.signature_kind, v.run_id, v.created_at, v.voided_at,
          coalesce(m.marks, '[]'::jsonb) as marks
        from (select * from contracts.sign_versions
              where contract_id = ${contractId}::uuid and file_id = ${fileId}::uuid and tenant_id = ${tenantId}::uuid
              order by seq limit ${SIGN_VERSIONS_LIST_MAX}) v
        left join lateral (
          select jsonb_agg(jsonb_build_object('id', k.id, 'signer_id', k.signer_id, 'field_id', k.field_id,
            'placement', k.placement, 'parts', k.parts, 'user_signature_id', k.user_signature_id, 'caption', k.caption,
            'created_at', k.created_at) order by k.created_at, k.id) as marks
          from contracts.sign_marks k where k.version_id = v.id and k.tenant_id = ${tenantId}::uuid) m on true
        order by v.seq`),
    /**
     * Q17 · Trả lại/Từ chối: đánh dấu void mọi bản (chưa void) của lượt `runId` + mở lại các chỗ đã ký trong các bản đó (một câu).
     * Bản của lượt khác không bị đụng. Trả các bản vừa void.
     */
    voidByRun: (runId: string) =>
      tx.execute<{ id: string; file_id: string; contract_id: string }>(sql`
        with v as (
          update contracts.sign_versions set voided_at = now()
          where run_id = ${runId}::uuid and tenant_id = ${tenantId}::uuid and voided_at is null
          returning id, file_id, contract_id),
        f as (
          update contracts.sign_fields set signed_by = null, signed_version_id = null
          where tenant_id = ${tenantId}::uuid and signed_version_id in (select id from v)
          returning id)
        select id, file_id, contract_id from v`),
  };
}
