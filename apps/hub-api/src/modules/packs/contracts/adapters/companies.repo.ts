// HD8-FR-09: câu SQL của danh bạ công ty — MỘT câu mỗi hàm, lọc `tenant_id` tường minh ngoài RLS. Danh sách kèm số HĐ + vai từ HĐ
// người dùng thấy (RLS M1, `routes/companies._contracts`).
import type { Company } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { one } from "./ledger-sql";

const COLS =
  sql.raw(`'party', co.party_key, 'tax_id', co.tax_id, 'name', co.name, 'short_name', co.short_name,
  'international_name', co.international_name, 'address', co.address, 'status', co.status, 'active', co.active,
  'edited', to_jsonb(co.edited), 'registry_result', co.registry_result, 'created_from', co.created_from`);

export type CompanyUse = {
  party: string;
  contract_count: number;
  roles: ("customer" | "supplier")[];
};

export function companiesRepo(tx: Tx, t: string) {
  return {
    list: () =>
      one<{ companies: Company[]; use: CompanyUse[] }>(
        tx,
        sql`select jsonb_build_object(
            'companies', coalesce((select jsonb_agg(jsonb_build_object(${COLS})) from contracts.companies co
              where co.tenant_id = ${t}::uuid), '[]'::jsonb),
            'use', coalesce((select jsonb_agg(jsonb_build_object('party', u.k, 'contract_count', u.n, 'roles', u.roles))
              from (select x.k, count(*) filter (where c.kind = 'contract') as n, jsonb_agg(distinct x.role) as roles
                from contracts.contracts c cross join lateral (values
                  (contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'), 'supplier'),
                  (contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value'), 'customer')) x (k, role)
                where c.tenant_id = ${t}::uuid and x.k in (select co.party_key from contracts.companies co
                  where co.tenant_id = ${t}::uuid)
                group by x.k) u), '[]'::jsonb)) as j`,
      ),

    /** Một công ty (khoá hàng để sửa tuần tự khi `lock`). */
    get: (party: string, lock = false) =>
      one<Company | null>(
        tx,
        lock
          ? sql`select jsonb_build_object(${COLS}) as j from contracts.companies co
              where co.tenant_id = ${t}::uuid and co.party_key = ${party} for update`
          : sql`select jsonb_build_object(${COLS}) as j from contracts.companies co
              where co.tenant_id = ${t}::uuid and co.party_key = ${party}`,
      ),

    /** Thêm (đã có ⇒ null, để báo 409). */
    insert: (c: Company) =>
      one<Company | null>(
        tx,
        sql`insert into contracts.companies as co (tenant_id, party_key, tax_id, name, short_name, international_name, address,
            status, active, edited, registry_result, registry_synced_at, created_from)
          values (${t}::uuid, ${c.party}, ${c.tax_id}, ${c.name}, ${c.short_name}, ${c.international_name}, ${c.address},
            ${c.status}, ${c.active}::boolean, ${`{${c.edited.join(",")}}`}::text[], ${c.registry_result},
            case when ${c.registry_result}::text = 'found' then now() end, ${c.created_from})
          on conflict (tenant_id, party_key) do nothing
          returning jsonb_build_object(${COLS}) as j`,
      ),

    save: (c: Company) =>
      one<Company>(
        tx,
        sql`update contracts.companies co set name = ${c.name}, short_name = ${c.short_name},
            international_name = ${c.international_name}, address = ${c.address}, status = ${c.status},
            active = ${c.active}::boolean, edited = ${`{${c.edited.join(",")}}`}::text[], registry_result = ${c.registry_result},
            registry_synced_at = case when ${c.registry_result}::text = 'found' then now() else co.registry_synced_at end,
            updated_at = now()
          where co.tenant_id = ${t}::uuid and co.party_key = ${c.party}
          returning jsonb_build_object(${COLS}) as j`,
      ),
  };
}
export type CompaniesRepo = ReturnType<typeof companiesRepo>;
