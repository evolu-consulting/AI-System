// HD-FR-07 · HD-NFR-01 · D-03 · D-07 · D-10 · HD1 plan §6 (Luật 4c): repo đọc gói hợp đồng trong tx `PackUow` (role
// `contracts_rw`, RLS FORCE). SQL văn bản CỐ ĐỊNH cho mọi tổ hợp (chuẩn bị một lần/kết nối): mọi bộ lọc `($x is null or col = any($x))`,
// mảng = MỘT tham số literal `{…}` (drizzle nở mảng JS thành danh sách). Lát tenant vật chất hoá một lần (`f`/`c` MATERIALIZED);
// total + trang cùng câu. Chỉ cột sinh hẹp — KHÔNG đọc `fields`/`source_text` (TOAST). Mọi câu lọc `tenant_id` tường minh ngoài RLS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ContractListFilter,
  ContractsOwnRepos,
  ContractsReadRepo,
} from "../application/ports";
import {
  type ContractFacetsDto,
  type ContractListRowDto,
  type FacetsRaw,
  type ListRowRaw,
  toContractFacets,
  toContractListRow,
} from "./contracts.mapper";

/** Mảng chuỗi → literal mảng Postgres `{"a","b"}` (một tham số); `null` giữ nguyên (= không lọc). */
export function pgTextArray(xs: readonly string[] | null): string | null {
  if (xs === null) return null;
  return `{${xs.map((x) => `"${x.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

type ListOut = { total: number; items: ListRowRaw[] | string };

async function list(tx: Tx, tid: string, f: ContractListFilter) {
  const a = pgTextArray;
  const cats = a(f.category);
  const rows = await tx.execute<ListOut>(sql`with f as materialized (
      select c.id, c.updated_at, c.value, c.end_date, c.title from contracts.contracts c
      where c.tenant_id = ${tid}::uuid
        and (${a(f.status)}::text[] is null or c.status = any(${a(f.status)}::text[]))
        and (${a(f.owner)}::uuid[] is null or c.owner_user_id = any(${a(f.owner)}::uuid[]))
        and (${a(f.seller)}::text[] is null or c.seller = any(${a(f.seller)}::text[]))
        and (${a(f.buyer)}::text[] is null or c.buyer = any(${a(f.buyer)}::text[]))
        and (${a(f.signerKeys)}::text[] is null or c.signer_keys && ${a(f.signerKeys)}::text[])
        and (${a(f.direction)}::text[] is null or coalesce(c.direction, 'unknown') = any(${a(f.direction)}::text[]))
        and (${a(f.kind)}::text[] is null or c.kind = any(${a(f.kind)}::text[]))
        and (${f.valueMin}::bigint is null or c.value >= ${f.valueMin}::bigint)
        and (${f.valueMax}::bigint is null or c.value <= ${f.valueMax}::bigint)
        and (${f.like}::text is null or c.search_key like ${f.like}::text)
        and (${cats}::uuid[] is null or c.id in (select i.contract_id from contracts.contract_items i
             where i.tenant_id = ${tid}::uuid and i.category_id = any(${cats}::uuid[])))),
    p as (select f.id from f order by
        case when ${f.order}::text = 'updated_at:desc' then f.updated_at end desc,
        case when ${f.order}::text = 'updated_at:asc' then f.updated_at end asc,
        case when ${f.order}::text = 'value:desc' then f.value end desc nulls last,
        case when ${f.order}::text = 'value:asc' then f.value end asc nulls last,
        case when ${f.order}::text = 'end_date:desc' then f.end_date end desc nulls last,
        case when ${f.order}::text = 'end_date:asc' then f.end_date end asc nulls last,
        case when ${f.order}::text = 'title:desc' then f.title end desc,
        case when ${f.order}::text = 'title:asc' then f.title end asc,
        f.id desc
      limit ${f.limit}::int offset ${f.offset}::int)
    select (select count(*) from f)::int as total,
      coalesce((select json_agg(r order by r.ord) from (
        select c.id, c.kind, c.parent_id, c.title, c.number, c.type, c.direction, c.status, c.seller, c.buyer,
          c.seller_signer, c.buyer_signer, c.value, c.end_date, c.action_deadline, c.owner_user_id, c.updated_at, c.version,
          array(select distinct i.category_id from contracts.contract_items i
                where i.contract_id = c.id and i.tenant_id = c.tenant_id and i.category_id is not null limit 50) as category_ids,
          pp.ord
        from (select p.id, row_number() over () as ord from p) pp
        join contracts.contracts c on c.id = pp.id and c.tenant_id = ${tid}::uuid) r), '[]'::json) as items`);
  const out = rows[0] as ListOut;
  const items = typeof out.items === "string" ? (JSON.parse(out.items) as ListRowRaw[]) : out.items;
  return { total: out.total, items: items.map(toContractListRow) };
}

const FACET_CAP = 500;
const CATEGORY_CAP = 200;

/** MỘT lượt đọc lát tenant (không CTE vật chất hoá hàng): GROUPING SETS 8 cột + `()` (bitmask `grouping()`: status 127,
 *  direction 191, kind 223, owner 239, seller 247, buyer 251, người ký k1 253 / k2 254, tổng 255 cho min/max giá trị). Người ký
 *  dùng cột sinh `signer_keys` (không gọi `person_key` mỗi hàng — hàm có `SET search_path` không inline được, ~80 µs/lần);
 *  `label` = min(raw) theo vị trí khoá (k2 trùng k1 ⇒ bỏ để đếm HĐ một lần; 1 khoá mà cả hai bên có raw ⇒ không rõ raw ⇒ nhãn =
 *  khoá). Loại hàng: cặp (loại, HĐ) khác nhau qua `items_category_idx`. Lấy tới trần + 1 để mapper biết có cắt. */
async function facets(tx: Tx, tid: string): Promise<ContractFacetsDto> {
  const rows = await tx.execute<FacetsRaw>(sql`with g as materialized (
      select grouping(c.status, c.direction, c.kind, c.owner, c.seller, c.buyer, c.k1, c.k2) as gs,
        coalesce(c.status, c.direction, c.kind, c.owner, c.seller, c.buyer, c.k1, c.k2) as v, count(*)::int as n,
        min(c.l1) as l1, min(c.l2) as l2, min(c.value) as vmin, max(c.value) as vmax
      from (select c.status, coalesce(c.direction, 'unknown') as direction, c.kind, c.owner_user_id::text as owner,
          c.seller, c.buyer, c.signer_keys[1] as k1,
          case when c.signer_keys[2] is distinct from c.signer_keys[1] then c.signer_keys[2] end as k2,
          case when cardinality(c.signer_keys) = 2 or c.buyer_signer is null then c.seller_signer
               when c.seller_signer is null then c.buyer_signer end as l1,
          c.buyer_signer as l2, c.value
        from contracts.contracts c where c.tenant_id = ${tid}::uuid) c
      group by grouping sets ((c.status), (c.direction), (c.kind), (c.owner), (c.seller), (c.buyer), (c.k1), (c.k2), ())),
    sg as (select g.v, sum(g.n)::int as n, coalesce(min(case when g.gs = 253 then g.l1 else g.l2 end), g.v) as label
      from g where g.gs in (253, 254) and g.v is not null group by g.v),
    cg as (select x.v, count(*)::int as n from (select i.category_id as v, i.contract_id from contracts.contract_items i
        where i.tenant_id = ${tid}::uuid and i.category_id is not null group by 1, 2) x group by x.v)
    select
      (select json_agg(json_build_object('v', v, 'n', n) order by n desc, v) from g where gs = 127 and v is not null) as status,
      (select json_agg(json_build_object('v', v, 'n', n) order by n desc, v) from g where gs = 191 and v is not null) as direction,
      (select json_agg(json_build_object('v', v, 'n', n) order by n desc, v) from g where gs = 223 and v is not null) as kind,
      (select json_agg(json_build_object('v', x.v, 'n', x.n) order by x.n desc, x.v) from (select v, n from g
        where gs = 239 and v is not null order by n desc, v limit ${FACET_CAP + 1}::int) x) as owner,
      (select json_agg(json_build_object('v', x.v, 'n', x.n) order by x.n desc, x.v) from (select v, n from g
        where gs = 247 and v is not null order by n desc, v limit ${FACET_CAP + 1}::int) x) as seller,
      (select json_agg(json_build_object('v', x.v, 'n', x.n) order by x.n desc, x.v) from (select v, n from g
        where gs = 251 and v is not null order by n desc, v limit ${FACET_CAP + 1}::int) x) as buyer,
      (select json_agg(json_build_object('v', x.v, 'label', x.label, 'n', x.n) order by x.n desc, x.v) from (select v, label, n
        from sg order by n desc, v limit ${FACET_CAP + 1}::int) x) as signer,
      (select json_agg(json_build_object('v', x.v, 'label', cc.name, 'n', x.n) order by x.n desc, x.v) from (select v, n
        from cg order by n desc, v limit ${CATEGORY_CAP + 1}::int) x
        join contracts.contract_categories cc on cc.id = x.v and cc.tenant_id = ${tid}::uuid) as category,
      (select json_build_object('min', g.vmin, 'max', g.vmax) from g where g.gs = 255 and g.vmin is not null) as value`);
  return toContractFacets(rows[0] as FacetsRaw, { text: FACET_CAP, category: CATEGORY_CAP });
}

export function contractsRepo(
  tx: Tx,
  tenantId: string,
): ContractsReadRepo<ContractListRowDto, ContractFacetsDto> {
  return { list: (f) => list(tx, tenantId, f), facets: () => facets(tx, tenantId) };
}

/** Repo riêng của gói trong một tx (`createPackUow(db, "contracts", contractsRepos)`). */
export const contractsRepos = (
  tx: Tx,
  tenantId: string,
): ContractsOwnRepos<ContractListRowDto, ContractFacetsDto> => ({
  contracts: contractsRepo(tx, tenantId),
});
