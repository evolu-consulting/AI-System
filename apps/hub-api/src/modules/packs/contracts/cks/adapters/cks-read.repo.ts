// HD-FR-93 · HD-FR-95 · HD-FR-96 · HD9 plan §5 (Luật 4c): câu ĐỌC của CKS — mỗi hàm MỘT câu SQL văn bản cố định, lọc `tenant_id`
// tường minh ngoài RLS, trả JSON (bigint ⇒ số JSON chính xác, không float). Gom/tính ở domain.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { CksOverviewOut, CksRepo, LotOut, SignedDocOut } from "../application/ports";
import type { CertRow } from "../domain/customers.rules";
import type { LotIn, MarketIn, SoldIn } from "../domain/prices.rules";

type J<T> = { j: T };
const one = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T> =>
  ((await tx.execute<J<T>>(q))[0] as J<T>).j;

/** CTE đầu của `liveCertsQ`: id khách + số văn bản của chính chữ ký (`own`) + của chuỗi chữ ký nó đã thay (`anc`). */
const liveDocCtes = (t: string, ids: string) =>
  sql`with recursive ids as (select v::uuid as id from jsonb_array_elements_text(${ids}::jsonb) v),
      own as (
        select d.certificate_id as cert, count(*)::int as n from contracts.cks_signed_docs d
        where d.tenant_id = ${t}::uuid and d.certificate_id is not null
          and d.customer_id in (select id from ids)
        group by d.certificate_id),
      chain as (
        select c.id as root, c.replaces as cur, 1 as depth from contracts.cks_certificates c
        where c.tenant_id = ${t}::uuid and c.status in ('active', 'pending_renewal') and c.replaces is not null
          and c.customer_id in (select id from ids)
        union all
        select ch.root, p.replaces, ch.depth + 1 from chain ch
        join contracts.cks_certificates p on p.id = ch.cur and p.tenant_id = ${t}::uuid
        where p.replaces is not null and ch.depth < 50),
      anc as (select ch.root, sum(o.n)::int as n from chain ch join own o on o.cert = ch.cur group by ch.root),`;

/** Chữ ký còn hiệu lực + khách + HĐ bán + gia hạn mở + số văn bản theo chuỗi `replaces` (đệ quy, ≤ 50 đời). */
function liveCertsQ(tx: Tx, t: string): CksRepo["liveCerts"] {
  return async (customerIds) => {
    // Đo HD9-AC09: không ORDER BY ở SQL (sắp hàng rộng tốn ~16 ms / 5.500 hàng) — domain sắp; đếm văn bản = của chính chữ ký
    // + của các chữ ký nó đã thay (chỉ đệ quy cho hàng có `replaces`).
    const rows = await tx.execute<
      CertRow & { sale_price: string | null }
    >(sql`${liveDocCtes(t, JSON.stringify(customerIds))}
      -- Mỗi HĐ bán đọc fields MỘT lần (không giải nén jsonb theo từng chữ ký).
      k as materialized (
        select k.id, k.number, coalesce(k.fields -> 'signed_date' ->> 'value', k.fields -> 'start_date' ->> 'value') as signed,
          -- HD7-FR-11 (overview.py:39): có đợt (trừ bị thay) và mọi đợt đã xong.
          (exists (select 1 from contracts.obligations o where o.tenant_id = ${t}::uuid and o.contract_id = k.id
              and o.status <> 'replaced')
            and not exists (select 1 from contracts.obligations o where o.tenant_id = ${t}::uuid and o.contract_id = k.id
              and o.status not in ('done', 'replaced'))) as paid
        from contracts.contracts k
        where k.tenant_id = ${t}::uuid and k.id in (select c.sale_contract_id from contracts.cks_certificates c
          where c.tenant_id = ${t}::uuid and c.status in ('active', 'pending_renewal')
            and c.customer_id in (select id from ids)))
      select c.id::text, c.customer_id::text, cu.name as customer_name, c.serial, c.ca, c.device, c.holder_name,
        c.holder_title, c.keeper, c.valid_from::text, c.valid_to::text, c.source, c.lot_id::text,
        c.sale_contract_id::text, c.sale_price::text, c.status, coalesce(o.n, 0) + coalesce(a.n, 0) as signed_count,
        k.number as sale_number,
        k.signed as sale_signed_at, coalesce(k.paid, false) as sale_paid, r.id::text as renewal_id
      from contracts.cks_certificates c
      join contracts.cks_customers cu on cu.id = c.customer_id and cu.tenant_id = ${t}::uuid
      left join k on k.id = c.sale_contract_id
      left join contracts.cks_renewals r on r.tenant_id = ${t}::uuid and r.sale_contract_id = c.sale_contract_id
        and r.status = 'open'
      left join own o on o.cert = c.id
      left join anc a on a.root = c.id
      where c.tenant_id = ${t}::uuid and c.status in ('active', 'pending_renewal')
        and c.customer_id in (select id from ids)`);
    // bigint đọc dạng chữ ⇒ số nguyên chính xác (≤ 10¹⁰, BR-1) — không qua float.
    return rows
      .map((x) => ({ ...x, sale_price: x.sale_price === null ? null : Number(x.sale_price) }))
      .sort(byExpiry);
  };
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
/** (`valid_to`, `id`) như `docs.find(sort="valid_to")` — thứ tự quyết định CA hoà (`topCa`). */
const byExpiry = (a: CertRow, b: CertRow): number => cmp(a.valid_to, b.valid_to) || cmp(a.id, b.id);

/** Bốn số tổng quan (`overview.py:17-23`) đếm ở SQL — không chở từng chữ ký ra app. */
function overviewQ(tx: Tx, t: string): CksRepo["overview"] {
  return (today) =>
    one<CksOverviewOut>(
      tx,
      sql`with live as (select c.customer_id, c.valid_to - ${today}::date as left_days from contracts.cks_certificates c
          where c.tenant_id = ${t}::uuid and c.status in ('active', 'pending_renewal'))
      select jsonb_build_object(
        'certificates', (select count(*) from live),
        'customers', (select count(distinct customer_id) from live),
        'expiring_30', (select count(*) from live where left_days between 0 and 30),
        'expired', (select count(*) from live where left_days < 0),
        'in_stock', coalesce((select sum(l.qty) from contracts.cks_lots l where l.tenant_id = ${t}::uuid), 0)
          - (select count(*) from contracts.cks_certificates c
             where c.tenant_id = ${t}::uuid and c.lot_id is not null and c.replaces is null)) as j`,
    );
}

/** Một trang khách (HD9-AC09: không chở cả tenant): lọc/tìm/sắp ở SQL theo khách, trả id theo thứ tự + tổng + danh sách CA.
 *  Sắp (`days_left`, tên theo điểm mã — `collate "C"`) như `overview.py:72`; tìm bỏ dấu (`contracts.fold`) trên tên khách,
 *  CA, người giữ, chức danh, serial (như `CksPage.tsx:44`). */
function customerPageQ(tx: Tx, t: string): CksRepo["customerPage"] {
  return (q) =>
    one(
      tx,
      sql`with live as (
        select c.customer_id, c.valid_to, c.ca, c.source, c.sale_contract_id, c.lot_id,
          -- Đo HD9-AC09: fold chỉ khi có ô tìm (CASE bảo đảm không gọi khi không tìm).
          case when ${q.like}::text <> '%%' then contracts.fold(concat_ws(' ', c.ca, c.holder_name, c.holder_title, c.serial)) end as text
        from contracts.cks_certificates c
        where c.tenant_id = ${t}::uuid and c.status in ('active', 'pending_renewal')),
      agg as (
        select l.customer_id, min(l.valid_to) - ${q.today}::date as left_days,
          bool_and(l.sale_contract_id is null and l.source = 'elsewhere') as elsewhere,
          bool_or(l.lot_id = ${q.lot ?? null}::uuid) as has_lot, bool_or(l.ca = ${q.ca ?? null}::text) as has_ca,
          bool_or(l.text like ${q.like}) as hit
        from live l group by l.customer_id),
      f as (
        select a.customer_id, a.left_days, cu.name from agg a
        join contracts.cks_customers cu on cu.id = a.customer_id and cu.tenant_id = ${t}::uuid
        where (${q.lot ?? null}::uuid is null or a.has_lot) and (${q.ca ?? null}::text is null or a.has_ca)
          and (${q.filter ?? null}::text is null
            or (${q.filter ?? null}::text = 'expiring' and a.left_days between 0 and 30)
            or (${q.filter ?? null}::text = 'expired' and a.left_days < 0)
            or (${q.filter ?? null}::text = 'elsewhere' and a.elsewhere))
          and case when ${q.like}::text = '%%' then true else a.hit or contracts.fold(cu.name) like ${q.like} end),
      pg as (select customer_id, row_number() over (order by left_days, name collate "C", customer_id) as ord from f
        order by left_days, name collate "C", customer_id limit ${q.size} offset ${q.offset})
      select jsonb_build_object(
        'total', (select count(*) from f),
        'ids', coalesce((select jsonb_agg(customer_id order by ord) from pg), '[]'::jsonb),
        'cas', coalesce((select jsonb_agg(distinct ca order by ca) from live), '[]'::jsonb)) as j`,
    );
}

function lotsQ(tx: Tx, t: string): CksRepo["lots"] {
  return () =>
    one<LotOut[]>(
      tx,
      sql`select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'label', l.label, 'ca', l.ca, 'qty', l.qty, 'unit_cost', l.unit_cost, 'years', l.years,
        'device', l.device, 'bought_at', l.bought_at, 'purchase_contract_id', l.purchase_contract_id,
        'sold', s.sold, 'customers', s.customers, 'in_stock', l.qty - s.sold, 'margin', s.margin)
        order by l.bought_at, l.id), '[]'::jsonb) as j
      from contracts.cks_lots l
      cross join lateral (
        select count(c.id)::int as sold, count(distinct c.customer_id)::int as customers,
          case when count(c.id) = 0 then null
            else coalesce(sum(c.sale_price - l.unit_cost) filter (where c.sale_price is not null), 0) end as margin
        from contracts.cks_certificates c
        where c.tenant_id = ${t}::uuid and c.lot_id = l.id and c.replaces is null) s
      where l.tenant_id = ${t}::uuid`,
    );
}

function priceInputsQ(tx: Tx, t: string): CksRepo["priceInputs"] {
  return () =>
    one<{ lots: LotIn[]; sold: SoldIn[]; market: MarketIn[] }>(
      tx,
      sql`select jsonb_build_object(
        'lots', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ca', l.ca, 'years', l.years,
            'device', l.device, 'unit_cost', l.unit_cost, 'bought_at', l.bought_at) order by l.bought_at, l.id)
          from contracts.cks_lots l where l.tenant_id = ${t}::uuid), '[]'::jsonb),
        'sold', coalesce((select jsonb_agg(jsonb_build_object('lot_id', c.lot_id, 'valid_from', c.valid_from,
            'sale_price', c.sale_price) order by c.valid_to, c.id)
          from contracts.cks_certificates c
          where c.tenant_id = ${t}::uuid and c.lot_id is not null and c.replaces is null), '[]'::jsonb),
        'market', coalesce((select jsonb_agg(jsonb_build_object('ca_key', m.ca_key, 'years', m.years,
            'device', m.device, 'kind', m.kind, 'seller', m.seller, 'tier', m.tier, 'price_ex_vat', m.price_ex_vat,
            'url', m.url, 'verified', m.verified, 'seen', m.seen) order by m.seen, m.id)
          from contracts.cks_market_prices m where m.tenant_id = ${t}::uuid), '[]'::jsonb)) as j`,
    );
}

/** Văn bản của khách; `certificate_id` ⇒ cả các chữ ký nó đã thay (chuỗi `replaces`, `signed_docs.py:35-38`). */
function signedDocsQ(tx: Tx, t: string): CksRepo["signedDocs"] {
  return (q) =>
    one<SignedDocOut[]>(
      tx,
      sql`with recursive chain as (
        select c.id, c.replaces, 1 as depth from contracts.cks_certificates c
        where ${q.certificate_id ?? null}::uuid is not null and c.id = ${q.certificate_id ?? null}::uuid
          and c.tenant_id = ${t}::uuid
        union all
        select p.id, p.replaces, ch.depth + 1 from chain ch
        join contracts.cks_certificates p on p.id = ch.replaces and p.tenant_id = ${t}::uuid where ch.depth < 50)
      select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'certificate_id', d.certificate_id, 'kind', d.kind,
        'number', d.number, 'title', d.title, 'signed_at', d.signed_at, 'source', d.source, 'contract_id', null)
        order by d.signed_at desc nulls last, d.created_at desc, d.id), '[]'::jsonb) as j
      from contracts.cks_signed_docs d
      where d.tenant_id = ${t}::uuid and d.customer_id = ${q.customer_id}::uuid
        -- M1c (review A-1): khách phải thấy được (RLS cks_customers) — gộp vào câu (HD9-AC09: 1 câu nghiệp vụ).
        and exists (select 1 from contracts.cks_customers cu
          where cu.id = ${q.customer_id}::uuid and cu.tenant_id = ${t}::uuid)
        and (${q.certificate_id ?? null}::uuid is null or d.certificate_id in (select id from chain))
        and (${q.kind ?? null}::text is null or d.kind = ${q.kind ?? null}::text)`,
    );
}

function customerExistsQ(tx: Tx, t: string): CksRepo["customerExists"] {
  return async (id) =>
    one<boolean>(
      tx,
      sql`select exists (select 1 from contracts.cks_customers where tenant_id = ${t}::uuid and id = ${id}::uuid) as j`,
    );
}

export const cksReadRepo = (tx: Tx, t: string) => ({
  liveCerts: liveCertsQ(tx, t),
  overview: overviewQ(tx, t),
  customerPage: customerPageQ(tx, t),
  lots: lotsQ(tx, t),
  priceInputs: priceInputsQ(tx, t),
  signedDocs: signedDocsQ(tx, t),
  customerExists: customerExistsQ(tx, t),
});
