// CR-182 · R7 «Kiểm tra tệp»: tìm bản đã lưu có sha256 = dấu vân tay tệp tải lên. MỘT câu văn bản hằng, trong tx `PackUow` (RLS tenant +
// quyền xem HĐ: join `contracts.contracts` ⇒ chỉ HĐ người gọi thấy; tenant khác không bao giờ thấy). Bản đã ký bị void không tính.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { VerifyCandidate } from "../domain/verify-file.rules";
import { contractNameSql } from "./contract-name.sql";

type Row = {
  which: "original" | "signed";
  contract_id: string;
  title: string;
  sha256: string;
  signed_by: string | null;
  at: string | Date | null;
  file_id: string | null;
  version_id: string | null;
  seq: number | null;
};

export type VerifyFileRepo = ReturnType<typeof verifyFileRepo>;

export function verifyFileRepo(tx: Tx, tenantId: string) {
  return {
    find: async (sha256: string): Promise<VerifyCandidate[]> => {
      const rows = await tx.execute<Row>(sql`
        (select 'signed' as which, c.id as contract_id, ${contractNameSql("c")} as title, v.sha256, v.signed_by::text as signed_by,
            v.created_at as at, v.file_id::text as file_id, v.id::text as version_id, v.seq
          from contracts.sign_versions v
          join contracts.contracts c on c.id = v.contract_id and c.tenant_id = v.tenant_id
          where v.tenant_id = ${tenantId}::uuid and v.sha256 = ${sha256} and v.voided_at is null
          order by v.created_at desc limit 5)
        union all
        (select 'original', c.id, ${contractNameSql("c")}, d.src_sha256, null, null, null, null, null
          from contracts.sign_docs d
          join contracts.contracts c on c.id = d.contract_id and c.tenant_id = d.tenant_id
          where d.tenant_id = ${tenantId}::uuid and d.src_sha256 = ${sha256}
          order by d.set_at desc limit 5)`);
      return rows.map((r) => ({
        contractId: r.contract_id,
        contractTitle: r.title,
        which: r.which,
        sha256: r.sha256,
        signedBy: r.signed_by,
        signedAt: r.at === null ? null : new Date(r.at).toISOString(),
        fileId: r.file_id,
        seq: r.seq === null ? null : Number(r.seq),
        versionId: r.version_id,
      }));
    },
  };
}
