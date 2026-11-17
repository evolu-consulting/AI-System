// CR-181 · s8 · đọc cho «Ký trên tài liệu»: tệp của HĐ (chính + kèm) và người ký đối tác. SQL trong tx `PackUow` (RLS tenant + hiển thị HĐ), mỗi thao tác MỘT câu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

import type { PartnerSigner, SignFileRef } from "../application/sign-doc.ports";

export type SignDocRepo = ReturnType<typeof signDocRepo>;

export function signDocRepo(tx: Tx, tenantId: string) {
  return {
    /** Mọi tệp (chính trước, rồi tệp kèm theo thời điểm gắn) — một câu. */
    files: (contractId: string) =>
      tx.execute<SignFileRef>(sql`
        select x.file_id, x.name, x.mime, x.org, x.box_id, x.is_main, x.added_by from (
          select f.id as file_id, f.name, f.mime, f.org, f.file_id as box_id, true as is_main, null::uuid as added_by,
            c.created_at as at
          from contracts.contracts c
          join contracts.files f on f.id = c.file_id and f.tenant_id = c.tenant_id and f.deleted_at is null
          where c.id = ${contractId}::uuid and c.tenant_id = ${tenantId}::uuid
          union all
          select f.id, f.name, f.mime, f.org, f.file_id, false, cf.added_by, cf.added_at
          from contracts.contract_files cf
          join contracts.files f on f.id = cf.file_id and f.tenant_id = cf.tenant_id and f.deleted_at is null
          where cf.contract_id = ${contractId}::uuid and cf.tenant_id = ${tenantId}::uuid) x
        order by x.is_main desc, x.at, x.file_id`),
    /** Liên hệ đầu tiên CÓ email của đối tác HĐ (cùng thứ tự với `esign.repo.contract`). Không có đối tác ⇒ null. */
    partner: async (contractId: string): Promise<PartnerSigner | null> => {
      const [r] = await tx.execute<PartnerSigner>(sql`
        select pc.name, pc.email, p.name as partner_name
        from contracts.contracts c
        left join lateral contracts.partner_role_of(c) p on true
        left join lateral (select x.name, x.email from contracts.partner_contacts x
          where x.tenant_id = c.tenant_id and x.party_key = p.party_key and x.email is not null and btrim(x.email) <> ''
          order by x.sort, x.created_at, x.id limit 1) pc on true
        where c.id = ${contractId}::uuid and c.tenant_id = ${tenantId}::uuid`);
      return r?.email ? r : null;
    },
  };
}
