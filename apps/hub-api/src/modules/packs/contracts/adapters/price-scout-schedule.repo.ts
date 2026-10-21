// price-scout · SQL vòng dò giá theo lịch (khuôn HD4 `reminders.repo.ts`). `scoutDueFinder`: tx role `contracts_job` (chỉ đọc
// tenant_id/next_at/lease_until, policy `next_at IS NOT NULL`), index `(next_at)` một phần. `scoutScheduleRepo`: tx `contracts_rw` +
// `app.tenant_id` (RLS FORCE) và vẫn lọc `tenant_id` tường minh. `claim` = MỘT câu: số SP được nhận = min(lượt đồng thời còn trống,
// trần ngày còn lại, trần tháng còn lại; hết token tháng ⇒ 0) ⇒ chọn `FOR UPDATE OF c SKIP LOCKED` qua index `(tenant_id, next_at)`
// ⇒ đặt lease ⇒ cộng bộ đếm ngày. `apply` = MỘT câu cho cả lô (dữ liệu lô qua một tham số jsonb).
import type { Db, Tx } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type {
  ClaimedProduct,
  ScoutDueFinder,
  ScoutScheduleRepo,
} from "../application/price-scout.ports";
import { json, one } from "./ledger-sql";
import { cleanOverride } from "./price-scout.clean";
import { USED } from "./price-scout.repo";

const uuids = (a: readonly string[]) => `{${a.join(",")}}`;

export function scoutDueFinder(db: Db, packKey: string): ScoutDueFinder {
  return {
    next: (now, skip) =>
      withPackJobScope(db, packKey, async (tx) => {
        const [r] = await tx.execute<{ tenant_id: string }>(sql`
          select tenant_id from contracts.price_scout_configs
          where next_at <= ${now}::timestamptz and (lease_until is null or lease_until < ${now}::timestamptz)
            and tenant_id <> all(${uuids(skip)}::uuid[])
          order by next_at limit 1`);
        return r?.tenant_id ?? null;
      }),
  };
}

/** Câu nhận lô (xuất ra cho test perf đo đúng câu này). */
export const claimSql = (
  t: string,
  { now, today, m }: { now: string; today: string; m: string },
  l: { concurrency: number; daily: number; systemSearches: number; leaseS: number },
) => sql`with ${USED(t, m, l.systemSearches, today)},
  lim as (select greatest(0, least(
      ${l.concurrency}::int - (select count(*)::int from contracts.price_scout_configs k
        where k.tenant_id = ${t}::uuid and k.lease_until > ${now}::timestamptz),
      ${l.daily}::int - u.today_n, q.lim - u.n,
      case when q.tlim is not null and u.tk >= q.tlim then 0 else ${l.concurrency}::int end)) as n from u, q),
  pick as (select c.product_id, c.next_at from contracts.price_scout_configs c
    where c.tenant_id = ${t}::uuid and c.next_at <= ${now}::timestamptz
      and (c.lease_until is null or c.lease_until < ${now}::timestamptz)
    order by c.next_at limit ${l.concurrency}::int for update of c skip locked),
  take as (select product_id from pick order by next_at limit (select n from lim)),
  upd as (update contracts.price_scout_configs c
      set lease_until = ${now}::timestamptz + ${l.leaseS}::int * interval '1 second'
    from take where c.tenant_id = ${t}::uuid and c.product_id = take.product_id
    returning c.product_id, c.cfg, c.last_at),
  cnt as (insert into contracts.price_scout_usage (tenant_id, day, scheduled)
    select ${t}::uuid, ${today}::date, count(*)::int from upd having count(*) > 0
    on conflict (tenant_id, day) do update set scheduled = contracts.price_scout_usage.scheduled + excluded.scheduled)
  select coalesce(jsonb_agg(jsonb_build_object('product_id', upd.product_id, 'name', p.name, 'override', upd.cfg,
      'group_saved', coalesce(d.cfg, '{}'::jsonb), 'last_at', upd.last_at,
      'avg_cost', (select nullif(c2.avg_cost, 0) from contracts.product_components c2 where c2.tenant_id = ${t}::uuid
        and c2.product_id = p.id and c2.mode <> 'none' order by c2.ord limit 1),
      'previous', coalesce((select jsonb_object_agg(x.k, x.price) from (
          select distinct on (lower(s.supplier_name)) lower(s.supplier_name) as k, s.price
          from contracts.product_supplier_prices s
          where s.tenant_id = ${t}::uuid and s.product_id = p.id and s.source = 'market' and s.kind = 'new'
          order by lower(s.supplier_name), s.seen_on desc, s.created_at desc) x), '{}'::jsonb))), '[]'::jsonb) as j
  from upd join contracts.products p on p.tenant_id = ${t}::uuid and p.id = upd.product_id
    left join contracts.price_scout_defaults d on d.tenant_id = ${t}::uuid and d.grp = p.grp`;

type ClaimRaw = Omit<ClaimedProduct, "override" | "group_saved"> & {
  override: unknown;
  group_saved: unknown;
};

export function scoutScheduleRepo(tx: Tx, t: string): ScoutScheduleRepo {
  return {
    async claim(now, today, m, l) {
      const rows = await one<ClaimRaw[]>(tx, claimSql(t, { now, today, m }, l));
      return (rows ?? []).map((r) => ({
        ...r,
        avg_cost: r.avg_cost === null ? null : Number(r.avg_cost),
        override: cleanOverride(r.override),
        group_saved: cleanOverride(r.group_saved),
      }));
    },

    async apply(now, today, results) {
      await tx.execute(sql`with r as (select * from jsonb_to_recordset(${json(results)}) as x(product_id uuid,
          status text, items jsonb, alerts jsonb, tokens bigint, next_at timestamptz)),
        ins as (insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, supplier_party_key,
            kind, price, unit, source, url, seen_on, note)
          select ${t}::uuid, r.product_id, i.supplier_name, contracts.party_key(i.supplier_name, null), i.kind, i.price,
            i.unit, 'market', i.url, coalesce(i.seen_on, ${today}::date), i.note
          from r cross join jsonb_to_recordset(r.items) as i(supplier_name text, kind text, price bigint, unit text,
            url text, seen_on date, note text)
          returning 1),
        al as (insert into contracts.price_scout_alerts (tenant_id, product_id, day, kind, detail, supplier_name, price)
          select ${t}::uuid, r.product_id, ${today}::date, a.kind, a.detail, a.supplier_name, a.price
          from r cross join jsonb_to_recordset(r.alerts) as a(kind text, detail text, supplier_name text, price bigint)
          returning 1),
        up as (update contracts.price_scout_configs c set lease_until = null, last_status = r.status, next_at = r.next_at,
            last_at = case when r.status in ('ok', 'empty', 'failed') then ${now}::timestamptz else c.last_at end
          from r where c.tenant_id = ${t}::uuid and c.product_id = r.product_id returning 1)
        update contracts.price_scout_usage set tokens = tokens + (select coalesce(sum(r.tokens), 0) from r)
        where tenant_id = ${t}::uuid and day = ${today}::date`);
    },

    async materialize(now) {
      const rows =
        await tx.execute(sql`insert into contracts.price_scout_configs (tenant_id, product_id, next_at)
        select p.tenant_id, p.id, ${now}::timestamptz from contracts.products p
          join contracts.price_scout_defaults d on d.tenant_id = p.tenant_id and d.grp = p.grp
        where p.tenant_id = ${t}::uuid and coalesce((d.cfg ->> 'enabled')::boolean, false)
          and coalesce(d.cfg ->> 'schedule', 'off') <> 'off'
          and not exists (select 1 from contracts.price_scout_configs c
            where c.tenant_id = p.tenant_id and c.product_id = p.id)
        on conflict do nothing returning product_id`);
      return rows.length;
    },
  };
}
