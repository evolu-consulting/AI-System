// V2-J1 · SP-01/02/07 · KN-15 · CD-06: câu SQL đọc điểm kinh doanh (gom THEO TẬP: một câu cho cả danh sách, số câu không đổi theo số SP)
// + lịch sử mua bán + HĐ theo SP + cấu hình (`score_configs_v2`, phạm vi `business`). Tx do `PackUow` mở (RLS tenant + luật thấy HĐ M1);
// lọc `tenant_id` tường minh. Mỗi hàm MỘT câu, văn bản cố định, dữ liệu qua tham số. Bán = SL ĐÃ GIAO của HĐ Bán (`milestone_items.delivered`,
// ngày = ngày xác nhận mốc giao); giá vốn = dòng sổ xuất của đúng mốc + dòng HĐ (đặt theo khách không có ⇒ không tính biên lãi).
import type { BizContractOut, BizLotOut, BizSaleOut } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { BizExtras, BizFilter, BizRow, StoredBiz } from "../application/business.ports";
import type { BizInput } from "../domain/business-score.rules";
import { likePattern } from "../domain/fold.rules";
import { CONFIRMED_STATUSES, one } from "./ledger-sql";

export type { BizExtras, BizFilter, BizRow, StoredBiz };

const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));
const n = (v: unknown) => Number(v ?? 0);

type Raw = {
  id: string;
  name: string;
  unit: string | null;
  grp: BizInput["group"];
  kind: BizInput["kind"];
  held: number;
  value: number;
  exp_days: number | null;
  exp_on: string | null;
  sold12: number;
  l3: number;
  p3: number;
  rev: number;
  cost: number;
  rev_all: number;
  comm_total: number;
  comm_got: number;
};

const toRow = (r: Raw): BizRow => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  value: n(r.value),
  expiresOn: r.exp_on,
  revenueAll: n(r.rev_all),
  input: {
    group: r.grp,
    kind: r.kind,
    heldQty: n(r.held),
    unit: r.unit,
    expiresInDays: r.exp_days === null ? null : n(r.exp_days),
    sold12: n(r.sold12),
    l3: n(r.l3),
    p3: n(r.p3),
    revenue: n(r.rev),
    cost: n(r.cost),
    commissionTotal: n(r.comm_total),
    commissionReceived: n(r.comm_got),
  },
});

export function businessRepo(tx: Tx, t: string) {
  /**
   * MỘT câu cho mọi SP khớp bộ lọc: tồn (thành phần ít nhất), hạn suất sớm nhất, bán 12 tháng / 3 tháng gần / 3 tháng trước (SL ĐÃ GIAO),
   * doanh thu + giá vốn các dòng có giá vốn, hoa hồng của HĐ Giới thiệu. `today` = ngày lịch tenant.
   */
  const rows = async (today: string, f: BizFilter): Promise<BizRow[]> => {
    const res = await one<Raw[]>(
      tx,
      sql`with ${salesCtes(t, today, f)}, ${referralCtes(t)} ${BIZ_SELECT}`,
    );
    return res.map(toRow);
  };

  /** Lô (kèm giá nhập, chênh giá so với lô trước của thành phần), bán (kèm giá vốn) và số HĐ của MỘT SP — một câu. */
  const extras = (id: string, today: string): Promise<BizExtras> =>
    one<BizExtras>(tx, extrasQ(t, id, today));

  /** HĐ có dòng gắn SP (mới nhất trước, ≤ 200) kèm hoa hồng của HĐ Giới thiệu. */
  const contractsOf = (id: string): Promise<BizContractOut[]> =>
    one<BizContractOut[]>(tx, contractsOfQ(t, id));

  const exists = async (id: string): Promise<boolean> =>
    (
      await tx.execute(
        sql`select 1 from contracts.products where tenant_id = ${t}::uuid and id = ${id}::uuid`,
      )
    ).length > 0;

  return { rows, extras, contractsOf, exists, ...bizConfig(tx, t) };
}
export type BusinessRepo = ReturnType<typeof businessRepo>;

function bizConfig(tx: Tx, t: string) {
  const config = (): Promise<StoredBiz> =>
    one<StoredBiz>(
      tx,
      sql`select jsonb_build_object('config', s.config, 'version', s.version, 'updated_at', s.updated_at) as j
        from contracts.score_configs_v2 s where s.tenant_id = ${t}::uuid and s.scope = 'business'`,
    );

  const saveConfig = (cfg: unknown): Promise<NonNullable<StoredBiz>> =>
    one<NonNullable<StoredBiz>>(
      tx,
      sql`insert into contracts.score_configs_v2 as s (tenant_id, scope, version, config)
        values (${t}::uuid, 'business', 1, ${JSON.stringify(cfg)}::jsonb)
        on conflict (tenant_id, scope) do update set version = s.version + 1, config = excluded.config,
          updated_by = excluded.updated_by, updated_at = now()
        returning jsonb_build_object('config', s.config, 'version', s.version, 'updated_at', s.updated_at) as j`,
    );
  return { config, saveConfig };
}

/** CTE ngày `d`, SP khớp lọc `p`, tồn `h`, hạn `ex`, giá vốn `mv`, dòng bán `sl`, gom bán `sa`. */
function salesCtes(t: string, today: string, f: BizFilter) {
  const id = f.id ?? null;
  const grp = f.group ?? null;
  const q = f.q ? likePattern(f.q) : null;
  return sql`d as (select ${today}::date as t),
      p as (select p.id, p.name, p.name_key, p.unit, p.grp from contracts.products p
        where p.tenant_id = ${t}::uuid and (${id}::uuid is null or p.id = ${id}::uuid)
          and (${grp}::text is null or p.grp = ${grp}::text)
          and (${q}::text is null or p.name_key like '%' || ${q}::text || '%')),
      h as (select c.product_id, bool_or(c.mode = 'quota') as has_quota, bool_or(c.mode = 'stock') as has_stock,
          coalesce(min(c.on_hand) filter (where c.mode in ('stock', 'quota')), 0)::float8 as held,
          coalesce(sum(c.stock_value), 0)::float8 as value
        from contracts.product_components c where c.tenant_id = ${t}::uuid and c.product_id in (select id from p)
        group by c.product_id),
      ex as (select c.product_id, min(l.expires_on) as exp_on
        from contracts.stock_lots l join contracts.product_components c on c.id = l.component_id and c.tenant_id = l.tenant_id
        where l.tenant_id = ${t}::uuid and l.remaining > 0 and l.expires_on is not null and c.mode = 'quota'
          and c.product_id in (select id from p)
        group by c.product_id),
      mv as (select m.milestone_id, m.contract_item_id, sum(m.amount) as cost from contracts.stock_moves m, d
        where m.tenant_id = ${t}::uuid and m.direction = 'out' and m.reason = 'delivery' and m.milestone_id is not null
          and m.moved_on > d.t - 365 group by m.milestone_id, m.contract_item_id),
      sl as (select i.product_id, o.done_at, mi.delivered as qty, i.unit_price, mv.cost
        from contracts.milestone_items mi
        join contracts.obligations o on o.tenant_id = mi.tenant_id and o.id = mi.milestone_id and o.kind = 'delivery'
          and o.status = 'done'
        join contracts.contract_items i on i.tenant_id = mi.tenant_id and i.id = mi.contract_item_id
          and i.product_id in (select id from p)
        join contracts.contracts c on c.tenant_id = mi.tenant_id and c.id = mi.contract_id and c.deal = 'sell' and c.kind = 'contract'
        left join mv on mv.milestone_id = mi.milestone_id and mv.contract_item_id = mi.contract_item_id
        cross join d
        where mi.tenant_id = ${t}::uuid and mi.delivered > 0 and o.done_at > d.t - 365),
      sa as (select sl.product_id, sum(sl.qty)::float8 as sold12,
          coalesce(sum(sl.qty) filter (where sl.done_at > d.t - 91), 0)::float8 as l3,
          coalesce(sum(sl.qty) filter (where sl.done_at <= d.t - 91 and sl.done_at > d.t - 182), 0)::float8 as p3,
          coalesce(sum(sl.qty * sl.unit_price) filter (where sl.cost is not null and sl.unit_price is not null), 0)::float8 as rev,
          coalesce(sum(sl.cost) filter (where sl.cost is not null and sl.unit_price is not null), 0)::float8 as cost,
          coalesce(sum(sl.qty * sl.unit_price), 0)::float8 as rev_all
        from sl, d group by sl.product_id)`;
}

/** CTE hoa hồng `oc`, HĐ Giới thiệu theo SP `rc`, gom `rf`. */
function referralCtes(t: string) {
  return sql`oc as (select o.contract_id, sum(o.amount) filter (where o.status in ('open', 'done')) as total,
          sum(o.amount) filter (where o.status = 'done') as got
        from contracts.obligations o where o.tenant_id = ${t}::uuid and o.kind = 'commission' group by o.contract_id),
      rc as (select distinct i.product_id, c.id as cid, coalesce(c.confirmed_at, c.created_at)::date as dt
        from contracts.contract_items i join contracts.contracts c on c.tenant_id = i.tenant_id and c.id = i.contract_id
        where i.tenant_id = ${t}::uuid and i.product_id in (select id from p where grp = 'referral')
          and c.deal = 'referral' and c.kind = 'contract' and c.status in (${CONFIRMED})),
      rf as (select rc.product_id, count(*) filter (where rc.dt > d.t - 365)::float8 as sold12,
          count(*) filter (where rc.dt > d.t - 91)::float8 as l3,
          count(*) filter (where rc.dt <= d.t - 91 and rc.dt > d.t - 182)::float8 as p3,
          coalesce(sum(oc.total), 0)::float8 as total, coalesce(sum(oc.got), 0)::float8 as got
        from rc join d on true left join oc on oc.contract_id = rc.cid group by rc.product_id)`;
}

const BIZ_SELECT = sql`select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'grp', p.grp,
          'kind', case when p.grp = 'referral' then 'referral' when h.has_quota then 'quota' when h.has_stock then 'stock' else 'order' end,
          'held', coalesce(h.held, 0), 'value', coalesce(h.value, 0),
          'exp_days', case when ex.exp_on is null then null else greatest(0, ex.exp_on - d.t) end,
          'exp_on', to_char(ex.exp_on, 'YYYY-MM-DD'),
          'sold12', coalesce(case when p.grp = 'referral' then rf.sold12 else sa.sold12 end, 0),
          'l3', coalesce(case when p.grp = 'referral' then rf.l3 else sa.l3 end, 0),
          'p3', coalesce(case when p.grp = 'referral' then rf.p3 else sa.p3 end, 0),
          'rev', coalesce(sa.rev, 0), 'cost', coalesce(sa.cost, 0), 'rev_all', coalesce(sa.rev_all, 0),
          'comm_total', coalesce(rf.total, 0), 'comm_got', coalesce(rf.got, 0)) order by p.name_key), '[]'::jsonb) as j
      from p cross join d left join h on h.product_id = p.id left join ex on ex.product_id = p.id
        left join sa on sa.product_id = p.id left join rf on rf.product_id = p.id`;

function extrasQ(t: string, id: string, today: string) {
  return sql`with lots as (select l.id, l.seq, l.received_on, l.qty, l.remaining, l.expires_on, c.name as comp, m.unit_cost,
          m.contract_id, k.seller,
          lag(m.unit_cost) over (partition by l.component_id order by l.seq) as prev
        from contracts.stock_lots l
        join contracts.product_components c on c.id = l.component_id and c.tenant_id = l.tenant_id
        left join contracts.stock_moves m on m.tenant_id = l.tenant_id and m.lot_id = l.id and m.direction = 'in'
        left join contracts.contracts k on k.tenant_id = m.tenant_id and k.id = m.contract_id
        where l.tenant_id = ${t}::uuid and c.product_id = ${id}::uuid),
      mv as (select m.milestone_id, m.contract_item_id, sum(m.amount) as cost from contracts.stock_moves m
        where m.tenant_id = ${t}::uuid and m.direction = 'out' and m.reason = 'delivery' and m.milestone_id is not null
          and m.moved_on > ${today}::date - 365 group by m.milestone_id, m.contract_item_id),
      sales as (select o.done_at, c.id as cid, c.title, c.buyer, mi.delivered as qty, i.unit_price, mv.cost
        from contracts.milestone_items mi
        join contracts.obligations o on o.tenant_id = mi.tenant_id and o.id = mi.milestone_id and o.kind = 'delivery'
          and o.status = 'done' and o.done_at > ${today}::date - 365
        join contracts.contract_items i on i.tenant_id = mi.tenant_id and i.id = mi.contract_item_id and i.product_id = ${id}::uuid
        join contracts.contracts c on c.tenant_id = mi.tenant_id and c.id = mi.contract_id and c.deal = 'sell' and c.kind = 'contract'
        left join mv on mv.milestone_id = mi.milestone_id and mv.contract_item_id = mi.contract_item_id
        where mi.tenant_id = ${t}::uuid and mi.delivered > 0)
      select jsonb_build_object(
        'lots', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'received_on', x.received_on, 'qty', x.qty::float8,
            'remaining', x.remaining::float8, 'unit_cost', x.unit_cost, 'expires_on', x.expires_on, 'supplier', x.seller,
            'contract_id', x.contract_id, 'component', x.comp,
            'price_change', case when x.unit_cost is null or x.prev is null then null else x.unit_cost - x.prev end)
            order by x.seq desc) from (select * from lots order by seq desc limit 100) x), '[]'::jsonb),
        'sales', coalesce((select jsonb_agg(jsonb_build_object('on', s.done_at, 'contract_id', s.cid, 'contract_title', s.title,
            'customer', s.buyer, 'qty', s.qty::float8, 'unit_price', s.unit_price, 'cost', s.cost,
            'profit', case when s.unit_price is null or s.cost is null then null else (s.qty * s.unit_price)::bigint - s.cost end)
            order by s.done_at desc, s.cid) from (select * from sales order by done_at desc limit 100) s), '[]'::jsonb),
        'contracts_count', (select count(*)::int from contracts.contracts k where k.tenant_id = ${t}::uuid and k.kind = 'contract'
          and exists (select 1 from contracts.contract_items i where i.tenant_id = k.tenant_id and i.contract_id = k.id
            and i.product_id = ${id}::uuid))) as j`;
}

function contractsOfQ(t: string, id: string) {
  return sql`select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'number', k.number, 'deal', k.deal,
          'status', k.status, 'partner', case when k.deal = 'buy' then k.seller else k.buyer end, 'value', k.value,
          'start_date', k.start_date,
          'commission_total', case when k.deal = 'referral' then coalesce(oc.total, 0) end,
          'commission_received', case when k.deal = 'referral' then coalesce(oc.got, 0) end)
          order by k.created_at desc, k.id), '[]'::jsonb) as j
        from (select * from contracts.contracts k where k.tenant_id = ${t}::uuid and k.kind = 'contract'
            and exists (select 1 from contracts.contract_items i where i.tenant_id = k.tenant_id and i.contract_id = k.id
              and i.product_id = ${id}::uuid)
          order by k.created_at desc, k.id limit 200) k
        left join (select o.contract_id, sum(o.amount) filter (where o.status in ('open', 'done')) as total,
            sum(o.amount) filter (where o.status = 'done') as got
          from contracts.obligations o where o.tenant_id = ${t}::uuid and o.kind = 'commission' group by o.contract_id) oc
          on oc.contract_id = k.id`;
}
