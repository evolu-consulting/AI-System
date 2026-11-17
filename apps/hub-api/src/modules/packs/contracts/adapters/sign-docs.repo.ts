// CR-181 · «Cần ký» theo từng tệp của HĐ (`contracts.sign_docs`). SQL trong tx `PackUow` (role `contracts_rw`, RLS tenant); `tenant_id` tường minh.
// Mỗi thao tác MỘT câu văn bản hằng. Quyền/trạng thái HĐ do use case (lát s8) kiểm — repo chỉ ghi/đọc.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type SignDocRow = {
  file_id: string;
  needs_sign: boolean;
  pages: number | null;
  set_by: string;
  set_at: Date;
};

export type SignDocsRepo = ReturnType<typeof signDocsRepo>;

export function signDocsRepo(tx: Tx, tenantId: string) {
  return {
    /** Mọi tệp đã từng đặt cờ của HĐ (tệp chưa đặt ⇒ không có hàng ⇒ coi như không cần ký). */
    listByContract: (contractId: string) =>
      tx.execute<SignDocRow>(sql`
        select file_id, needs_sign, pages, set_by, set_at from contracts.sign_docs
        where contract_id = ${contractId}::uuid and tenant_id = ${tenantId}::uuid
        order by set_at, file_id`),
    get: async (contractId: string, fileId: string): Promise<SignDocRow | null> => {
      const [r] = await tx.execute<SignDocRow>(sql`
        select file_id, needs_sign, pages, set_by, set_at from contracts.sign_docs
        where contract_id = ${contractId}::uuid and file_id = ${fileId}::uuid and tenant_id = ${tenantId}::uuid`);
      return r ?? null;
    },
    /** Đặt/đổi cờ. `pages` null ⇒ giữ số trang đã biết (đếm lúc bật «Cần ký»). HĐ không có ⇒ null. */
    set: async (
      contractId: string,
      fileId: string,
      needsSign: boolean,
      pages: number | null,
      by: string,
    ): Promise<SignDocRow | null> => {
      const [r] = await tx.execute<SignDocRow>(sql`
        insert into contracts.sign_docs (tenant_id, contract_id, file_id, needs_sign, pages, set_by)
        select ${tenantId}::uuid, c.id, ${fileId}::uuid, ${needsSign}, ${pages}::int, ${by}::uuid
        from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tenantId}::uuid
        on conflict (contract_id, file_id) do update
          set needs_sign = excluded.needs_sign, pages = coalesce(excluded.pages, contracts.sign_docs.pages),
              set_by = excluded.set_by, set_at = now()
        returning file_id, needs_sign, pages, set_by, set_at`);
      return r ?? null;
    },
  };
}
