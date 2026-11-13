// CR-141 · SQL tải bản đã ký (tx `PackUow`, role `contracts_rw`, RLS tenant + `tenant_id` tường minh). Bản ký lưu ĐÚNG chỗ bản ký số lưu:
// `contracts.files` + `esign_envelopes.signed_file_id` (provider `upload`, đã `completed`) — một nguồn cho «Hồ sơ», chi tiết HĐ, tải về.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type SignUploadRepo = ReturnType<typeof signUploadRepo>;
export type SignedUploadRow = {
  id: string;
  contractId: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  mime: string;
  size: number;
  by: string;
  override: boolean;
  signerName: string;
};

export function signUploadRepo(tx: Tx, t: string) {
  return {
    /** found=false ⇒ HĐ không thấy (404). Đang chờ = sự kiện mới nhất trong {mở chờ, đã tải, đã ký số} là «mở chờ». */
    async awaiting(
      contractId: string,
    ): Promise<{ found: boolean; awaiting: boolean; signers: string[] }> {
      const [r] = await tx.execute<{
        found: boolean;
        type: string | null;
        signers: string[] | null;
      }>(sql`
        select true as found, e.type, (e.data -> 'signers') as signers
        from contracts.contracts c
        left join lateral (select type, data from contracts.contract_events
          where tenant_id = ${t}::uuid and contract_id = c.id and type in ('sign_upload_open', 'esign_uploaded', 'esign_signed')
          order by id desc limit 1) e on true
        where c.id = ${contractId}::uuid and c.tenant_id = ${t}::uuid`);
      if (!r) return { found: false, awaiting: false, signers: [] };
      return { found: true, awaiting: r.type === "sign_upload_open", signers: r.signers ?? [] };
    },
    /** Ghi tệp + phong bì «upload» đã hoàn tất + một dòng lịch sử (ai tải, tên tệp). Chạy lại sau khi bước đã xong ⇒ false. */
    async insertSigned(r: SignedUploadRow): Promise<boolean> {
      const rows = await tx.execute<{ id: string }>(sql`with c as (
          select c.id from contracts.contracts c where c.id = ${r.contractId}::uuid and c.tenant_id = ${t}::uuid
            and (select e.type from contracts.contract_events e where e.tenant_id = ${t}::uuid and e.contract_id = c.id
              and e.type in ('sign_upload_open', 'esign_uploaded', 'esign_signed') order by e.id desc limit 1) = 'sign_upload_open'),
        f as (insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
          select ${r.id}::uuid, ${t}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime}, ${r.size}, ${r.by}::uuid
          from c returning id),
        e as (insert into contracts.esign_envelopes
            (tenant_id, contract_id, provider, envelope_id, status, signers, sent_by, completed_at, signed_file_id)
          select ${t}::uuid, ${r.contractId}::uuid, 'upload', ${r.id}, 'completed',
            jsonb_build_array(jsonb_build_object('role', 'company', 'name', ${r.signerName}::text, 'signed_at', now())),
            ${r.by}::uuid, now(), f.id from f returning id),
        ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, ${r.contractId}::uuid, 'esign_uploaded', ${r.by}::uuid,
            jsonb_build_object('file_name', ${r.name}::text, 'override', ${r.override}::boolean) from e)
        select id from e`);
      return rows.length === 1;
    },
  };
}
