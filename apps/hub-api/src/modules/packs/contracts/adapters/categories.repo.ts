// HD-FR-53 · HD5 plan: loại hàng của tenant trong tx `PackUow` (role `contracts_rw`, RLS FORCE). Văn bản SQL cố định, lọc `tenant_id`
// tường minh. Thêm = MỘT câu: chèn khi chưa tới trần và tên chưa có (chỉ mục `contract_categories_name_uq` trên `lower(name)`).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { CategoriesRepo, CategoryRow } from "../application/categories.usecase";

export function categoriesRepo(tx: Tx, tenantId: string): CategoriesRepo {
  return {
    list: (limit) =>
      tx.execute<CategoryRow>(sql`select c.id, c.name from contracts.contract_categories c
        where c.tenant_id = ${tenantId}::uuid order by lower(c.name), c.id limit ${limit}::int`),
    create: async (name, cap) => {
      const rows = await tx.execute<{
        id: string | null;
        name: string | null;
        n: number;
      }>(sql`with n as (
          select count(*)::int as n from contracts.contract_categories where tenant_id = ${tenantId}::uuid),
        i as (
          insert into contracts.contract_categories (tenant_id, name)
          select ${tenantId}::uuid, ${name}::text from n where n.n < ${cap}::int
          on conflict (tenant_id, lower(name)) do nothing
          returning id, name)
        select i.id, i.name, (select n from n) as n from n left join i on true`);
      const r = rows[0];
      if (r?.id && r.name) return { kind: "created", row: { id: r.id, name: r.name } };
      return r && r.n >= cap ? { kind: "full" } : { kind: "exists" };
    },
  };
}
