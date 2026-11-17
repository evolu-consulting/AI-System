// CR-181 · chỗ ký trên tệp (`contracts.sign_fields`). Chỗ ĐÃ ký (`signed_version_id` có giá trị) là lịch sử: `replaceForFile` không sửa/xoá chúng.
// Dữ liệu lô đi qua MỘT tham số JSON (`jsonb_to_recordset`) ⇒ số câu cố định, không phụ thuộc số chỗ ký.
import type { SignParts, SignSide } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type SignerKind = "user" | "group" | "partner";

export type SignFieldRow = {
  id: string;
  file_id: string;
  side: SignSide;
  signer_kind: SignerKind;
  signer_ref: string;
  label: string;
  parts: SignParts;
  created_by: string;
  created_at: Date;
  signed_by: string | null;
  signed_version_id: string | null;
};

export type NewSignField = {
  id: string;
  side: SignSide;
  signerKind: SignerKind;
  signerRef: string;
  label: string;
  parts: SignParts;
};

export type SignFieldsRepo = ReturnType<typeof signFieldsRepo>;

export function signFieldsRepo(tx: Tx, tenantId: string) {
  return {
    listByContract: (contractId: string) =>
      tx.execute<SignFieldRow>(sql`
        select id, file_id, side, signer_kind, signer_ref, label, parts, created_by, created_at, signed_by, signed_version_id
        from contracts.sign_fields
        where contract_id = ${contractId}::uuid and tenant_id = ${tenantId}::uuid
        order by file_id, created_at, id`),
    listByFile: (contractId: string, fileId: string) =>
      tx.execute<SignFieldRow>(sql`
        select id, file_id, side, signer_kind, signer_ref, label, parts, created_by, created_at, signed_by, signed_version_id
        from contracts.sign_fields
        where contract_id = ${contractId}::uuid and file_id = ${fileId}::uuid and tenant_id = ${tenantId}::uuid
        order by created_at, id`),
    /**
     * Đặt TOÀN BỘ chỗ ký của một tệp (một câu, một tx): chỗ chưa ký không có trong `fields` bị xoá; có `id` trùng ⇒ cập nhật; còn lại thêm mới.
     * Chỗ đã ký giữ nguyên (kể cả khi `fields` có id đó). Chưa có `sign_docs` của tệp ⇒ lỗi FK (use case phải đặt cờ trước).
     */
    replaceForFile: async (
      contractId: string,
      fileId: string,
      fields: readonly NewSignField[],
      by: string,
    ): Promise<{ removed: number; upserted: number }> => {
      const json = JSON.stringify(
        fields.map((f) => ({
          id: f.id,
          side: f.side,
          signer_kind: f.signerKind,
          signer_ref: f.signerRef,
          label: f.label,
          parts: f.parts,
        })),
      );
      const [r] = await tx.execute<{ removed: number; upserted: number }>(sql`
        with n as (
          select * from jsonb_to_recordset(${json}::jsonb)
            as x(id uuid, side text, signer_kind text, signer_ref text, label text, parts jsonb)),
        d as (
          delete from contracts.sign_fields
          where contract_id = ${contractId}::uuid and file_id = ${fileId}::uuid and tenant_id = ${tenantId}::uuid
            and signed_version_id is null and id not in (select id from n)
          returning id),
        u as (
          insert into contracts.sign_fields (id, tenant_id, contract_id, file_id, side, signer_kind, signer_ref, label, parts, created_by)
          select n.id, ${tenantId}::uuid, ${contractId}::uuid, ${fileId}::uuid, n.side, n.signer_kind, n.signer_ref, n.label, n.parts,
            ${by}::uuid from n
          on conflict (id) do update
            set side = excluded.side, signer_kind = excluded.signer_kind, signer_ref = excluded.signer_ref,
                label = excluded.label, parts = excluded.parts
            where contracts.sign_fields.signed_version_id is null
              and contracts.sign_fields.contract_id = excluded.contract_id and contracts.sign_fields.file_id = excluded.file_id
          returning id)
        select (select count(*) from d)::int as removed, (select count(*) from u)::int as upserted`);
      return r ?? { removed: 0, upserted: 0 };
    },
    /** Đánh dấu các chỗ (chưa ký) của HĐ là đã ký trong bản `versionId`. Trả số chỗ vừa đánh dấu. */
    markSigned: async (
      contractId: string,
      fieldIds: readonly string[],
      by: string,
      versionId: string,
    ): Promise<number> => {
      const rows = await tx.execute<{ id: string }>(sql`
        update contracts.sign_fields set signed_by = ${by}::uuid, signed_version_id = ${versionId}::uuid
        where contract_id = ${contractId}::uuid and tenant_id = ${tenantId}::uuid and signed_version_id is null
          and id in (select jsonb_array_elements_text(${JSON.stringify(fieldIds)}::jsonb)::uuid)
        returning id`);
      return rows.length;
    },
  };
}
