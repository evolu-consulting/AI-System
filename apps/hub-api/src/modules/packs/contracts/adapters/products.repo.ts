// V2-B · câu SQL danh mục SP. Tx do `PackUow` mở (RLS tenant + M1); lọc `tenant_id` tường minh. Mỗi lệnh = MỘT câu (JSON dựng trong
// SQL, văn bản cố định, dữ liệu qua tham số). Dòng sổ trong chi tiết SP theo luật thấy HĐ (policy `stock_moves_visible`).
import type {
  ProductCreate,
  ProductDetailOut,
  ProductOut,
  ProductRuleOut,
  ProductsQuery,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ProductsRepo } from "../application/products.usecase";
import { likePattern } from "../domain/fold.rules";
import type { ProductPlan } from "../domain/products.rules";
import { json, one } from "./ledger-sql";

/** JSON một SP (bí danh `p`) kèm thành phần + quy tắc. */
const productJson =
  sql.raw(`jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'group', p.grp,
  'main_supplier', case when p.main_supplier_party_key is null then null
    else jsonb_build_object('party_key', p.main_supplier_party_key, 'name', p.main_supplier_name) end,
  'created_from_contract_id', p.created_from_contract_id,
  'components', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'ord', c.ord, 'name', c.name, 'unit', c.unit,
      'mode', c.mode, 'on_hand', trim_scale(c.on_hand)::text, 'avg_cost', c.avg_cost, 'stock_value', c.stock_value) order by c.ord)
    from contracts.product_components c where c.tenant_id = p.tenant_id and c.product_id = p.id), '[]'::jsonb),
  'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pattern', r.pattern, 'component_id', r.component_id)
      order by r.created_at, r.id)
    from contracts.product_rules r where r.tenant_id = p.tenant_id and r.product_id = p.id), '[]'::jsonb))`);

export function productsRepo(tx: Tx, t: string): ProductsRepo {
  const list: ProductsRepo["list"] = (q: ProductsQuery & { limit: number }) =>
    one<ProductOut[]>(
      tx,
      sql`select coalesce(jsonb_agg(x.j order by x.name_key), '[]'::jsonb) as j from (
        select ${productJson} as j, p.name_key from contracts.products p
        where p.tenant_id = ${t}::uuid and (${q.group ?? null}::text is null or p.grp = ${q.group ?? null}::text)
          and (${q.q ? likePattern(q.q) : null}::text is null or p.name_key like '%' || ${q.q ? likePattern(q.q) : null}::text || '%')
        order by p.name_key limit ${q.limit}) x`,
    );

  const get: ProductsRepo["get"] = (id) =>
    one<ProductDetailOut | null>(
      tx,
      sql`select ${productJson} || jsonb_build_object(
          'lots', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'component_id', l.component_id,
              'qty', trim_scale(l.qty)::text, 'remaining', trim_scale(l.remaining)::text,
              'received_on', l.received_on, 'expires_on', l.expires_on) order by l.seq desc)
            from (select l.* from contracts.stock_lots l join contracts.product_components c
                    on c.id = l.component_id and c.tenant_id = l.tenant_id
                  where l.tenant_id = p.tenant_id and c.product_id = p.id order by l.seq desc limit 200) l), '[]'::jsonb),
          'moves', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'component_id', m.component_id,
              'direction', m.direction, 'reason', m.reason, 'qty', trim_scale(m.qty)::text, 'unit_cost', m.unit_cost,
              'amount', m.amount, 'on_hand_after', trim_scale(m.on_hand_after)::text, 'avg_after', m.avg_after,
              'moved_on', m.moved_on, 'contract_id', m.contract_id) order by m.seq desc)
            from (select m.* from contracts.stock_moves m join contracts.product_components c
                    on c.id = m.component_id and c.tenant_id = m.tenant_id
                  where m.tenant_id = p.tenant_id and c.product_id = p.id order by m.seq desc limit 100) m), '[]'::jsonb)) as j
        from contracts.products p where p.tenant_id = ${t}::uuid and p.id = ${id}::uuid`,
    );

  /** Một CTE: SP + thành phần + quy tắc. HĐ nguồn phải thấy được (RLS HĐ) — không thấy ⇒ không thêm gì (null). */
  const create: ProductsRepo["create"] = (p: ProductCreate, plan: ProductPlan) =>
    one<ProductOut | null>(
      tx,
      sql`with src as (
        select ${p.from_contract_id ?? null}::uuid as cid
        where ${p.from_contract_id ?? null}::uuid is null or exists (select 1 from contracts.contracts k
          where k.tenant_id = ${t}::uuid and k.id = ${p.from_contract_id ?? null}::uuid)),
      p as (
        insert into contracts.products (tenant_id, name, unit, grp, main_supplier_party_key, main_supplier_name,
          created_from_contract_id)
        select ${t}::uuid, ${p.name}, ${p.unit ?? null}, ${p.group},
          contracts.party_key(${p.main_supplier?.name ?? null}::text, ${p.main_supplier?.tax_id ?? null}::text),
          ${p.main_supplier?.name ?? null}, src.cid from src
        returning *),
      c as (
        insert into contracts.product_components (tenant_id, product_id, ord, name, unit, mode)
        select ${t}::uuid, p.id, x.ord, x.name, x.unit, x.mode
        from p, jsonb_to_recordset(${json(plan.components)}) as x(ord int, name text, unit text, mode text)
        returning id, ord, product_id),
      r as (
        insert into contracts.product_rules (tenant_id, product_id, component_id, pattern)
        select ${t}::uuid, p.id, c.id, x.pattern
        from p cross join jsonb_to_recordset(${json(plan.rules)}) as x(pattern text, component int)
          left join c on c.ord = x.component
        returning id, pattern, component_id, created_at)
      select jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'group', p.grp,
        'main_supplier', case when p.main_supplier_party_key is null then null
          else jsonb_build_object('party_key', p.main_supplier_party_key, 'name', p.main_supplier_name) end,
        'created_from_contract_id', p.created_from_contract_id,
        'components', (select jsonb_agg(jsonb_build_object('id', c.id, 'ord', x.ord, 'name', x.name, 'unit', x.unit,
            'mode', x.mode, 'on_hand', '0', 'avg_cost', 0, 'stock_value', 0) order by x.ord)
          from c join jsonb_to_recordset(${json(plan.components)}) as x(ord int, name text, unit text, mode text) on x.ord = c.ord),
        'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'pattern', r.pattern, 'component_id', r.component_id))
          from r), '[]'::jsonb)) as j
      from p`,
    );

  const addRule: ProductsRepo["addRule"] = (productId, pattern, componentId) =>
    one<ProductRuleOut | null>(
      tx,
      sql`insert into contracts.product_rules (tenant_id, product_id, component_id, pattern)
        select p.tenant_id, p.id, ${componentId}::uuid, ${pattern} from contracts.products p
        where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid
          and (${componentId}::uuid is null or exists (select 1 from contracts.product_components c
            where c.tenant_id = p.tenant_id and c.product_id = p.id and c.id = ${componentId}::uuid))
        returning jsonb_build_object('id', id, 'pattern', pattern, 'component_id', component_id) as j`,
    );

  const deleteRule: ProductsRepo["deleteRule"] = async (productId, ruleId) =>
    (
      await tx.execute(sql`delete from contracts.product_rules
        where tenant_id = ${t}::uuid and product_id = ${productId}::uuid and id = ${ruleId}::uuid returning id`)
    ).length > 0;

  return { list, get, create, addRule, deleteRule };
}
