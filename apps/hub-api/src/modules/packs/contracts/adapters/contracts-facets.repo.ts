// HD-NFR-02 · tách từ contracts.repo.ts (CR-127 R1 #3): facets danh sách HĐ (một câu SQL theo tập).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type ContractFacetsDto, type FacetsRaw, toContractFacets } from "./contracts.mapper";

export const FACET_CAP = 500;
export const CATEGORY_CAP = 200;

/** Một facet văn bản: đếm theo cột `col` trên các nhóm của tập `gs` (cộng lại vì tập gộp nhiều cột), tới trần + 1. Tên cột là
 *  hằng nội bộ (`sql.raw`, không từ người dùng) ⇒ văn bản SQL vẫn cố định. */
export const dim = (col: string, gs: number) =>
  sql.raw(`(select json_agg(json_build_object('v', x.v, 'n', x.n) order by x.n desc, x.v) from (select ${col} as v,
    sum(g.n)::int as n from g where g.gs = ${gs} and ${col} is not null group by ${col} order by n desc, v
    limit ${FACET_CAP + 1}) x)`);

/** MỘT lượt đọc lát tenant (D-22, Luật 4c): GROUPING SETS 4 tập gộp cột + `()` — bitmask `grouping(status, seller, k1, cats)`:
 *  7 = (status, direction, kind, owner), 11 = (seller, buyer), 13 = (k1, l1, k2, l2), 14 = (category_ids), 15 = tổng (min/max giá
 *  trị); mỗi facet cộng lại từ nhóm của tập mình (ít bảng băm hơn 8 tập một cột, không aggregate `min(nhãn)` trên mọi tập). Người ký
 *  dùng cột sinh `signer_keys` (không gọi `person_key` mỗi hàng); `label` = min(raw) theo vị trí khoá (k2 trùng k1 ⇒ bỏ để đếm HĐ
 *  một lần; 1 khoá mà cả hai bên có raw ⇒ nhãn = khoá). Loại hàng: nhóm theo mảng gộp sẵn `category_ids` (trigger câu lệnh) rồi
 *  `unnest` trên các mảng khác nhau — mỗi HĐ đếm một lần, không quét `contract_items`. Lấy tới trần + 1 để mapper biết có cắt. */
export async function facets(tx: Tx, tid: string): Promise<ContractFacetsDto> {
  const rows = await tx.execute<FacetsRaw>(sql`with g as materialized (
      select grouping(c.status, c.seller, c.k1, c.cats) as gs, c.status, c.direction, c.kind, c.owner, c.seller, c.buyer,
        c.k1, c.l1, c.k2, c.l2, c.cats, count(*)::int as n, min(c.value) as vmin, max(c.value) as vmax
      from (select c.status, coalesce(c.direction, 'unknown') as direction, c.kind, c.owner_user_id::text as owner,
          c.seller, c.buyer, c.signer_keys[1] as k1,
          case when c.signer_keys[2] is distinct from c.signer_keys[1] then c.signer_keys[2] end as k2,
          case when cardinality(c.signer_keys) = 2 or c.buyer_signer is null then c.seller_signer
               when c.seller_signer is null then c.buyer_signer end as l1,
          c.buyer_signer as l2, c.value, c.category_ids as cats
        from contracts.contracts c where c.tenant_id = ${tid}::uuid and c.superseded_at is null) c
      group by grouping sets ((c.status, c.direction, c.kind, c.owner), (c.seller, c.buyer), (c.k1, c.l1, c.k2, c.l2),
        (c.cats), ())),
    sg as (select x.k as v, sum(x.n)::int as n, coalesce(min(x.l), x.k) as label from (
        select g.k1 as k, g.l1 as l, g.n from g where g.gs = 13 and g.k1 is not null
        union all select g.k2, g.l2, g.n from g where g.gs = 13 and g.k2 is not null) x group by x.k),
    cg as (select v, sum(g.n)::int as n from g cross join lateral unnest(g.cats) v where g.gs = 14 group by v)
    select ${dim("status", 7)} as status, ${dim("direction", 7)} as direction, ${dim("kind", 7)} as kind,
      ${dim("owner", 7)} as owner, ${dim("seller", 11)} as seller, ${dim("buyer", 11)} as buyer,
      (select json_agg(json_build_object('v', x.v, 'label', x.label, 'n', x.n) order by x.n desc, x.v) from (select v, label, n
        from sg order by n desc, v limit ${FACET_CAP + 1}::int) x) as signer,
      (select json_agg(json_build_object('v', x.v, 'label', cc.name, 'n', x.n) order by x.n desc, x.v) from (select v, n
        from cg order by n desc, v limit ${CATEGORY_CAP + 1}::int) x
        join contracts.contract_categories cc on cc.id = x.v and cc.tenant_id = ${tid}::uuid) as category,
      (select json_build_object('min', g.vmin, 'max', g.vmax) from g where g.gs = 15 and g.vmin is not null) as value`);
  return toContractFacets(rows[0] as FacetsRaw, { text: FACET_CAP, category: CATEGORY_CAP });
}
