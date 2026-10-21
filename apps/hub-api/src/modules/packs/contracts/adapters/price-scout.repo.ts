// price-scout · SQL cấu hình dò giá + bộ đếm lượt/tháng. Tx do `PackUow` mở (RLS tenant, role `contracts_rw`); lọc `tenant_id` tường
// minh. Mỗi lệnh = số câu cố định (văn bản cố định, dữ liệu qua tham số) — Luật 4c. Lịch (`next_at`) theo cùng luật với
// `price-scout.rules.ts::nextScoutAt` (chưa dò ⇒ ngay; tuần = +7 ngày; tháng = +1 tháng lịch).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { ScoutRepo } from "../application/price-scout.ports";
import type { PriceScoutQuotaRow } from "../domain/price-scout.types";
import { json, one } from "./ledger-sql";
import { cleanOverride } from "./price-scout.clean";

const ME = sql`NULLIF(current_setting('app.user_id', true), '')::uuid`;

/** Lịch hiệu lực từ ghi đè `c` ⊕ mặc định nhóm `d` (jsonb): tắt ⇒ 'off'. */
export const SCHED = (c: string, d: string) =>
  sql.raw(`(case when coalesce((${c} ->> 'enabled')::boolean, (${d} ->> 'enabled')::boolean, false)
    then coalesce(${c} ->> 'schedule', ${d} ->> 'schedule', 'off') else 'off' end)`);
/** Lần dò kế theo lịch `s`, lần trước `last`, mốc `now`. */
export const NEXT = (s: SQL, last: string, now: string) =>
  sql`(case ${s} when 'weekly' then coalesce(${sql.raw(last)} + interval '7 days', ${now}::timestamptz)
    when 'monthly' then coalesce(${sql.raw(last)} + interval '1 month', ${now}::timestamptz) end)`;

/** Đã dùng tháng này (từ `m`) + trần (platform ?? tenant ?? hệ thống `sys`). */
export const USED = (t: string, m: string, sys: number, today: string | null = null) => sql`
  u as (select coalesce(sum(manual + scheduled), 0)::int as n, coalesce(sum(tokens), 0)::bigint as tk,
      coalesce(sum(scheduled) filter (where day = ${today}::date), 0)::int as today_n
    from contracts.price_scout_usage where tenant_id = ${t}::uuid and day >= ${m}::date),
  q as (select coalesce((select coalesce(x.platform_searches_month, x.searches_month) from contracts.price_scout_quota x
        where x.tenant_id = ${t}::uuid), ${sys}::int) as lim,
      (select coalesce(x.platform_tokens_month, x.tokens_month) from contracts.price_scout_quota x
        where x.tenant_id = ${t}::uuid) as tlim)`;

type ProductRaw = {
  name: string;
  group: "service" | "goods" | "referral";
  override: unknown;
  group_saved: unknown;
  next_at: string | null;
  last_at: string | null;
  last_status: string | null;
};

export const scoutRepo = (tx: Tx, t: string): ScoutRepo => ({
  ...productRepo(tx, t),
  ...defaultsRepo(tx, t),
  ...usageRepo(tx, t),
  ...quotaRepo(tx, t),
});

function productRepo(tx: Tx, t: string): Pick<ScoutRepo, "product" | "saveOverride"> {
  return {
    async product(id) {
      const r = await one<ProductRaw | null>(
        tx,
        sql`select jsonb_build_object('name', p.name, 'group', p.grp, 'override', coalesce(c.cfg, '{}'::jsonb),
          'group_saved', coalesce(d.cfg, '{}'::jsonb), 'next_at', c.next_at, 'last_at', c.last_at,
          'last_status', c.last_status) as j
        from contracts.products p
          left join contracts.price_scout_configs c on c.tenant_id = p.tenant_id and c.product_id = p.id
          left join contracts.price_scout_defaults d on d.tenant_id = p.tenant_id and d.grp = p.grp
        where p.tenant_id = ${t}::uuid and p.id = ${id}::uuid`,
      );
      return r
        ? { ...r, override: cleanOverride(r.override), group_saved: cleanOverride(r.group_saved) }
        : null;
    },

    async saveOverride(id, o, nextAt) {
      const rows = await tx.execute(sql`insert into contracts.price_scout_configs
          (tenant_id, product_id, cfg, next_at, updated_at)
        select p.tenant_id, p.id, ${json(o)}, ${nextAt}::timestamptz, now() from contracts.products p
        where p.tenant_id = ${t}::uuid and p.id = ${id}::uuid and p.grp <> 'referral'
        on conflict (tenant_id, product_id) do update set cfg = excluded.cfg, next_at = excluded.next_at,
          updated_by = ${ME}, updated_at = now()
        returning product_id`);
      return rows.length > 0;
    },
  };
}

function defaultsRepo(tx: Tx, t: string): Pick<ScoutRepo, "defaults" | "saveDefaults"> {
  return {
    async defaults() {
      const r = await one<Record<string, unknown>>(
        tx,
        sql`select coalesce(jsonb_object_agg(grp, cfg), '{}'::jsonb) as j from contracts.price_scout_defaults
          where tenant_id = ${t}::uuid`,
      );
      return {
        ...(r?.service ? { service: cleanOverride(r.service) } : {}),
        ...(r?.goods ? { goods: cleanOverride(r.goods) } : {}),
      };
    },

    // 3 câu cố định: lưu mặc định ⇒ (nhóm dò theo lịch) tạo hàng cho SP chưa có ⇒ tính lại lịch mọi hàng của nhóm.
    async saveDefaults(group, c, now) {
      await tx.execute(sql`insert into contracts.price_scout_defaults (tenant_id, grp, cfg)
        values (${t}::uuid, ${group}, ${json(c)})
        on conflict (tenant_id, grp) do update set cfg = excluded.cfg, updated_by = ${ME}, updated_at = now()`);
      if (c.enabled && c.schedule !== "off")
        await tx.execute(sql`insert into contracts.price_scout_configs (tenant_id, product_id)
          select p.tenant_id, p.id from contracts.products p where p.tenant_id = ${t}::uuid and p.grp = ${group}
          on conflict do nothing`);
      await tx.execute(sql`update contracts.price_scout_configs x
        set next_at = ${NEXT(SCHED("x.cfg", "d.cfg"), "x.last_at", now)}
        from contracts.products p, contracts.price_scout_defaults d
        where x.tenant_id = ${t}::uuid and p.tenant_id = ${t}::uuid and p.id = x.product_id and p.grp = ${group}
          and d.tenant_id = ${t}::uuid and d.grp = ${group}`);
    },
  };
}

function usageRepo(tx: Tx, t: string): Pick<ScoutRepo, "usage" | "reserveManual" | "settleManual"> {
  return {
    async usage(m) {
      const r = await one<{ searches: number; tokens: number; quota: PriceScoutQuotaRow | null }>(
        tx,
        sql`select jsonb_build_object(
          'searches', coalesce(sum(manual + scheduled), 0), 'tokens', coalesce(sum(tokens), 0),
          'quota', (select jsonb_build_object('searches_month', x.searches_month, 'tokens_month', x.tokens_month,
            'platform_searches_month', x.platform_searches_month, 'platform_tokens_month', x.platform_tokens_month)
            from contracts.price_scout_quota x where x.tenant_id = ${t}::uuid)) as j
        from contracts.price_scout_usage where tenant_id = ${t}::uuid and day >= ${m}::date`,
      );
      return { searches: Number(r.searches), tokens: Number(r.tokens), quota: r.quota ?? null };
    },

    async reserveManual(today, m, sys) {
      const rows = await tx.execute(sql`with ${USED(t, m, sys)},
        ok as (select 1 from u, q where u.n + 1 <= q.lim and (q.tlim is null or u.tk < q.tlim))
        insert into contracts.price_scout_usage (tenant_id, day, manual) select ${t}::uuid, ${today}::date, 1 from ok
        on conflict (tenant_id, day) do update set manual = contracts.price_scout_usage.manual + 1
        returning 1`);
      return rows.length > 0;
    },

    async settleManual(today, tokens, refund) {
      await tx.execute(sql`update contracts.price_scout_usage
        set tokens = tokens + ${Math.max(0, Math.floor(tokens))}::bigint,
          manual = greatest(0, manual - ${refund ? 1 : 0}::int)
        where tenant_id = ${t}::uuid and day = ${today}::date`);
    },
  };
}

function quotaRepo(tx: Tx, t: string): Pick<ScoutRepo, "saveQuota"> {
  return {
    async saveQuota(q, platform) {
      const ps = platform ? (q.platform_searches_month ?? null) : null;
      const pt = platform ? (q.platform_tokens_month ?? null) : null;
      await tx.execute(sql`insert into contracts.price_scout_quota (tenant_id, searches_month, tokens_month,
          platform_searches_month, platform_tokens_month)
        values (${t}::uuid, ${q.searches_month}::int, ${q.tokens_month}::bigint, ${ps}::int, ${pt}::bigint)
        on conflict (tenant_id) do update set searches_month = excluded.searches_month,
          tokens_month = excluded.tokens_month,
          platform_searches_month = case when ${platform}::boolean then excluded.platform_searches_month
            else contracts.price_scout_quota.platform_searches_month end,
          platform_tokens_month = case when ${platform}::boolean then excluded.platform_tokens_month
            else contracts.price_scout_quota.platform_tokens_month end,
          updated_by = ${ME}, updated_at = now()`);
    },
  };
}
