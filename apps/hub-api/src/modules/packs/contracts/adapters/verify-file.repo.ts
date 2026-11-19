// CR-188 · BR-188-6 «Kiểm tra tệp»: MỘT câu văn bản hằng dò sha256 trong MỌI bản đã ký (chưa huỷ) của công ty (`sign_versions` phủ HĐ, phụ lục,
// giấy tờ khác). Bảng HĐ nối LEFT JOIN dưới RLS «xem HĐ»: HĐ người gọi không xem được ⇒ cột HĐ null ⇒ `visible=false` và KHÔNG chi tiết nào ra
// khỏi câu SQL. Tenant khác không bao giờ khớp (`tenant_id` + RLS). Tệp gốc chưa ký (`src_sha256`) không dò nữa (Q3).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { docKindOf, type VerifyCandidate } from "../domain/verify-file.rules";
import { contractNameSql } from "./contract-name.sql";

type Row = {
  contract_id: string | null;
  title: string | null;
  kind: string | null;
  doc_type: string | null;
  partner: string | null;
  sha256: string;
  signed_by: string | null;
  at: string | Date;
  file_id: string | null;
  version_id: string | null;
  seq: number | null;
};

export type VerifyFileRepo = ReturnType<typeof verifyFileRepo>;

export function verifyFileRepo(tx: Tx, tenantId: string) {
  return {
    find: async (sha256: string, fromContractId?: string | null): Promise<VerifyCandidate[]> => {
      const rows = await tx.execute<Row>(sql`
        select c.id::text as contract_id, ${contractNameSql("c")} as title, c.kind, c.doc_type,
            case when c.direction = 'sale' then c.buyer else c.seller end as partner,
            v.sha256, case when c.id is null then null else v.signed_by::text end as signed_by, v.created_at as at,
            case when c.id is null then null else v.file_id::text end as file_id,
            case when c.id is null then null else v.id::text end as version_id,
            case when c.id is null then null else v.seq end as seq
          from contracts.sign_versions v
          left join contracts.contracts c on c.id = v.contract_id and c.tenant_id = v.tenant_id
          where v.tenant_id = ${tenantId}::uuid and v.sha256 = ${sha256} and v.voided_at is null
          order by (c.id = ${fromContractId ?? null}::uuid) desc nulls last, v.created_at desc limit 5`);
      return rows.map((r) => ({
        visible: r.contract_id !== null,
        contractId: r.contract_id,
        contractTitle: r.title,
        docKind: r.kind === null ? null : docKindOf(r.kind, r.doc_type ?? "contract"),
        partner: r.partner,
        sha256: r.sha256,
        signedBy: r.signed_by,
        signedAt: new Date(r.at).toISOString(),
        fileId: r.file_id,
        seq: r.seq === null ? null : Number(r.seq),
        versionId: r.version_id,
      }));
    },
  };
}
