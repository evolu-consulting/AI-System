// V2-K · TQ-02 · BA v2 §4.1 · §5.3c · §5.4 · §6 "Doanh thu, hoa hồng theo kỳ": MỘT câu SQL văn bản cố định gom mốc tiền theo THÁNG
// (24 tháng tới hết kỳ) + hàng đang giữ. Tx do `PackUow` mở (role `contracts_rw`, RLS tenant + luật thấy HĐ M1) ⇒ chỉ HĐ người dùng
// thấy được đếm; lọc `tenant_id` tường minh. Số câu không phụ thuộc số mốc (Luật 4c).
//
// Luật tiền (≡ `milestones.rules.ts`, V2-A 5.4a/5.4c): số tiền mốc = trường Số tiền; mốc tiền CHÍNH để trống (Thu tiền của HĐ Bán,
// Nhận hoa hồng của HĐ Giới thiệu) chia đều phần còn lại của cơ sở (giá trị HĐ, hoặc hoa hồng dự kiến = cố định ?? giá trị × % làm tròn
// nửa lên) cho các mốc trống, đồng lẻ dồn vào mốc trống đầu theo (hạn, seq, id); mốc trống loại phụ = 0. Mỗi mốc đếm MỘT lần: dự kiến
// theo hạn, thực nhận theo ngày xác nhận. Mốc huỷ/bị thay không tính.
// Lãi gộp (chỉ tháng từ `pa`): mốc thu × (giá trước VAT − giá vốn) ÷ giá trị HĐ; giá vốn HĐ = Σ dòng (giá vốn dòng sổ xuất đã giao +
// SL chưa giao × BQ hiện tại các thành phần). Dòng chưa gắn SP / thành phần không giữ hàng ⇒ giá vốn 0 + cờ `cost_missing`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { MonthRow } from "../domain/overview.rules";
import { CONFIRMED_STATUSES, one } from "./ledger-sql";

const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));

export type OverviewWindow = { from: string; to: string; profitFrom: string };
export type OverviewRaw = { months: MonthRow[]; stock: number };

export function overviewRepo(tx: Tx, t: string) {
  const months = (w: OverviewWindow): Promise<OverviewRaw> =>
    one<OverviewRaw>(
      tx,
      sql`with ${moneyCtes(t, w)}, ${costCtes(t)}, ${periodCtes()} ${monthsSelect(t)}`,
    );
  return { months };
}
export type OverviewRepo = ReturnType<typeof overviewRepo>;

/** Kỳ `p`, mốc tiền `w`, HĐ `k`, chia 5.4a `bx`, số tiền hiệu lực `e`, HĐ bán trong kỳ lãi `sc`. */
function moneyCtes(t: string, w: OverviewWindow) {
  return sql`p as (select ${w.from}::date as a, ${w.to}::date as b, ${w.profitFrom}::date as pa),
      w as materialized (select o.id, o.contract_id, o.kind = 'commission' as com, o.amount, o.status = 'done' as done,
          o.due_date, o.done_at
        from contracts.obligations o, p
        where o.tenant_id = ${t}::uuid and o.kind in ('payment', 'commission') and o.status in ('open', 'done')
          and (o.kind = 'commission' or o.direction = 'receive')
          and (o.due_date between p.a and p.b or (o.status = 'done' and o.done_at between p.a and p.b))),
      k as materialized (select c.id, c.deal, c.value, c.product_group = 'service' as svc,
          case when c.deal = 'referral' then coalesce(c.commission_fixed,
            floor((c.value::numeric * round(c.commission_pct * 100) + 5000) / 10000)::bigint) else c.value end as base
        from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.status in (${CONFIRMED})
          and c.deal is not null and c.id in (select contract_id from w)),
      -- 5.4a: mốc chính của HĐ trong k — MỘT lượt cửa sổ (Σ số tiền đã ghi, số mốc trống, hạng mốc trống); tách gom/sắp thành CTE
      -- riêng (đo: ước lượng 1 hàng ⇒ nested loop, 4 s) nên giữ một câu con.
      bx as (select x.id, case when x.base is not null then greatest(x.base - x.fixed, 0) / x.n
            + case when x.r < greatest(x.base - x.fixed, 0) % x.n then 1 else 0 end end as eff
        from (select o.id, o.amount, k.base, coalesce(sum(o.amount) over ca, 0)::bigint as fixed,
            count(*) filter (where o.amount is null) over ca as n,
            count(*) filter (where o.amount is null) over co - 1 as r
          from contracts.obligations o join k on k.id = o.contract_id
          where o.tenant_id = ${t}::uuid and o.kind in ('payment', 'commission') and o.status in ('open', 'done')
            and ((k.deal = 'sell' and o.kind = 'payment' and o.direction = 'receive') or (k.deal = 'referral' and o.kind = 'commission'))
          window co as (partition by o.contract_id order by o.due_date, o.seq, o.id rows unbounded preceding),
            ca as (partition by o.contract_id order by o.due_date, o.seq, o.id
              rows between unbounded preceding and unbounded following)) x
        where x.amount is null),
      e as materialized (select w.contract_id, w.due_date, w.done_at, w.done, w.com, k.deal = 'sell' and not w.com as rev, k.svc,
          coalesce(w.amount, case when (k.deal = 'sell' and not w.com) or (k.deal = 'referral' and w.com) then bx.eff end, 0) as amt
        from w join k on k.id = w.contract_id left join bx on bx.id = w.id),
      sc as (select distinct e.contract_id as id from e, p where e.rev and e.due_date between p.pa and p.b)`;
}

/** Giá vốn theo dòng `il`, theo HĐ `cg`, hệ số lãi `rk`. */
function costCtes(t: string) {
  return sql`
      -- Giá vốn theo dòng: gom theo tập từ BẢNG gốc (có thống kê ⇒ hash join; nối các CTE ước lượng 1 hàng từng làm planner chọn
      -- nested loop O(n²) — đo 320 ms ở 1.000 dòng). Thành phần chọn riêng (component_ids) tra theo dòng.
      il as (select i.contract_id, i.product_id, i.qty * i.unit_price as net,
          greatest(coalesce(i.qty, 0) - coalesce(dv.q, 0), 0) as rest, coalesce(dv.q, 0) as got,
          coalesce(mc.amt, 0) as moved, mc.amt is not null as has_moves,
          coalesce(us.avg, up.avg) as avg, coalesce(us.held, up.held) as held
        from contracts.contract_items i
        left join (select mi.contract_item_id as id, sum(mi.delivered) as q from contracts.milestone_items mi
          where mi.tenant_id = ${t}::uuid and mi.delivered is not null and mi.contract_id in (select id from sc)
          group by mi.contract_item_id) dv on dv.id = i.id
        left join (select m.contract_item_id as id, sum(m.amount) as amt from contracts.stock_moves m
          where m.tenant_id = ${t}::uuid and m.direction = 'out' and m.reason = 'delivery' and m.contract_id in (select id from sc)
          group by m.contract_item_id) mc on mc.id = i.id
        left join (select pc.product_id, sum(pc.avg_cost) as avg, bool_and(pc.mode in ('stock', 'quota')) as held
          from contracts.product_components pc where pc.tenant_id = ${t}::uuid group by pc.product_id) up
          on up.product_id = i.product_id and i.component_ids is null
        left join lateral (select sum(pc.avg_cost) as avg, bool_and(pc.mode in ('stock', 'quota')) as held
          from contracts.product_components pc where i.component_ids is not null and pc.tenant_id = ${t}::uuid
            and pc.product_id = i.product_id and pc.id = any (i.component_ids)) us on true
        where i.tenant_id = ${t}::uuid and i.contract_id in (select id from sc)),
      cg as materialized (select il.contract_id as id, coalesce(sum(il.moved + il.rest * coalesce(il.avg, 0)), 0) as cogs,
          sum(il.net) as net, bool_or(il.product_id is null or (il.rest > 0 and il.held is not true)
            or (il.got > 0 and not il.has_moves)) as missing
        from il group by il.contract_id),
      -- Hệ số lãi của HĐ bán trong kỳ + kỳ trước: (giá trước VAT − giá vốn) ÷ giá trị HĐ; không dòng ⇒ 1 + thiếu giá vốn.
      rk as materialized (select sc.id, coalesce((coalesce(cg.net, k.value) - coalesce(cg.cogs, 0))::numeric
            / nullif(coalesce(nullif(k.value, 0), nullif(cg.net, 0)), 0), 1) as ratio, coalesce(cg.missing, true) as missing
        from sc join k on k.id = sc.id left join cg on cg.id = sc.id)`;
}

/** Gom theo tháng: dự kiến theo hạn `ex`, thực nhận theo ngày xác nhận `ac`. */
function periodCtes() {
  return sql`ex as (select date_trunc('month', e.due_date) as m,
          sum(e.amt) filter (where e.rev) as rev_exp, sum(e.amt) filter (where e.com) as comm_exp,
          coalesce(sum(floor(e.amt * rk.ratio)) filter (where e.rev and e.due_date >= p.pa), 0)
            + coalesce(sum(e.amt) filter (where e.com and e.due_date >= p.pa), 0) as profit,
          coalesce(bool_or(rk.missing) filter (where e.rev and e.due_date >= p.pa), false) as cost_missing,
          sum(e.amt) filter (where e.rev and e.svc) as service, sum(e.amt) filter (where e.rev and not coalesce(e.svc, false)) as goods
        from e cross join p left join rk on rk.id = e.contract_id
        where e.due_date between p.a and p.b group by 1),
      ac as (select date_trunc('month', e.done_at) as m, sum(e.amt) filter (where e.rev) as rev_act,
          sum(e.amt) filter (where e.com) as comm_act
        from e, p where e.done and e.done_at between p.a and p.b group by 1)`;
}

function monthsSelect(t: string) {
  return sql`select jsonb_build_object(
        'months', coalesce((select jsonb_agg(jsonb_build_object('m', to_char(coalesce(ex.m, ac.m), 'YYYY-MM'),
            'rev_exp', coalesce(ex.rev_exp, 0)::bigint, 'rev_act', coalesce(ac.rev_act, 0)::bigint,
            'comm_exp', coalesce(ex.comm_exp, 0)::bigint, 'comm_act', coalesce(ac.comm_act, 0)::bigint,
            'profit', coalesce(ex.profit, 0)::bigint, 'cost_missing', coalesce(ex.cost_missing, false),
            'service', coalesce(ex.service, 0)::bigint, 'goods', coalesce(ex.goods, 0)::bigint) order by coalesce(ex.m, ac.m))
          from ex full join ac on ac.m = ex.m), '[]'::jsonb),
        'stock', (select coalesce(sum(pc.stock_value), 0)::bigint from contracts.product_components pc
          where pc.tenant_id = ${t}::uuid and pc.mode in ('stock', 'quota'))) as j`;
}
