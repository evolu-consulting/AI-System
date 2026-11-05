// CR-121 · cr121-c3a-overview-api · SQL của "Tổng quan admin platform". Luật 4c: SÁU câu văn bản cố định (không phụ thuộc số công
// ty/lượt chạy), mỗi câu quét bảng nguồn MỘT lần rồi gom (CTE + subselect), kết quả về dạng jsonb/số. Chạy dưới scope `system`
// (hub_api = hub_rw + hub_ro). Mốc thời gian là tham số `timestamptz` (đồng hồ giả được trong test).
//   Q1 process_runs (+ review_tasks theo process_run_id): lượt chạy, lỗi, p95 trừ chờ duyệt, 24 cột giờ, đang chạy/kẹt.
//   Q2 dify_run_stats (view hẹp của dify_runs, hub 0100, cộng admin.workflows lấy tên): lỗi công cụ AI, tỷ lệ lỗi 1 giờ, công cụ lỗi liên tiếp, lỗi nhiều nhất.
//   Q3 tenant_quotas + usage_logs: hạn mức USD tháng, công ty ≥ X %, chi phí theo ngày.
//   Q4 tenants: tổng công ty khách, công ty hoạt động 7 ngày (exists theo chỉ mục tenant+thời gian).
//   Q5 jobs/process_timers/pg_*: trễ hàng đợi nền, truy vấn chậm, kết nối, dung lượng.
//   Q6 ops_checks: kết quả mới nhất của `flow_coverage` (nguồn công ty chưa gán quy trình / cấu hình nửa vời).
import { OVERVIEW_AI_TOOL_STREAK } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

/** Khoá tenant nội bộ của nền tảng — không tính là công ty khách (như admin-api `overview.repo`). */
export const PLATFORM_TENANT_KEY = "platform";

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> =>
  (await tx.execute(q)) as unknown as T[];

export type Window = { now: Date; since1h: Date; since24: Date; since7: Date };
export type Bucket = { k: number };

export type RunsRow = {
  started: (Bucket & { n: number; c: number })[];
  finished: (Bucket & { ended: number; failed: number; done: number; p95_s: number | null })[];
  hourly: { h: number; ok: number; err: number }[];
  running: number;
  needs_decision: number;
  failed_24h: number;
  stuck: number;
};

/**
 * Q1. `stuckBefore` = now − N giờ. `w` = các lượt BẮT ĐẦU trong 7 ngày + mọi lượt đang mở (một lần quét, CTE dùng lại nhiều nơi);
 * điều kiện `OR` cho BitmapOr của `process_runs_started_at_idx` (migration hub 0100) và `process_runs_active_idx` (một phần, đúng
 * 4 trạng thái mở).
 */
export async function runsAgg(tx: Tx, win: Window, stuckBefore: Date): Promise<RunsRow> {
  const r = await rows<RunsRow>(
    tx,
    sql`
    with w as (
      select r.id, r.tenant_id, r.status, r.started_at, r.finished_at, r.updated_at,
        case when r.status = 'done' and r.finished_at is not null then greatest(0,
          extract(epoch from r.finished_at - r.started_at)
          - coalesce((select sum(greatest(0, extract(epoch from
                least(coalesce(k.decided_at, r.finished_at), r.finished_at) - k.created_at)))
              from hub.review_tasks k where k.process_run_id = r.id), 0)) end as work_s
      from hub.process_runs r
      join admin.tenants tn on tn.id = r.tenant_id and tn.key <> ${PLATFORM_TENANT_KEY}
      where r.started_at >= ${ts(win.since7)}
         or r.status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')),
    st as (
      select floor(extract(epoch from ${ts(win.now)} - started_at) / 86400)::int as k,
        count(*)::int as n, count(distinct tenant_id)::int as c
      from w where started_at >= ${ts(win.since7)} and started_at <= ${ts(win.now)} group by 1),
    fin as (
      select floor(extract(epoch from ${ts(win.now)} - finished_at) / 86400)::int as k,
        (count(*) filter (where status in ('done', 'failed', 'expired')))::int as ended,
        (count(*) filter (where status in ('failed', 'expired')))::int as failed,
        (count(*) filter (where status = 'done'))::int as done,
        (percentile_cont(0.95) within group (order by work_s) filter (where status = 'done'))::float8 as p95_s
      from w where finished_at >= ${ts(win.since7)} and finished_at <= ${ts(win.now)} group by 1),
    hr as (
      select floor(extract(epoch from ${ts(win.now)} - finished_at) / 3600)::int as h,
        (count(*) filter (where status = 'done'))::int as ok,
        (count(*) filter (where status in ('failed', 'expired')))::int as err
      from w where finished_at >= ${ts(win.since24)} and finished_at <= ${ts(win.now)} group by 1)
    select
      (select coalesce(jsonb_agg(to_jsonb(st)), '[]'::jsonb) from st) as started,
      (select coalesce(jsonb_agg(to_jsonb(fin)), '[]'::jsonb) from fin) as finished,
      (select coalesce(jsonb_agg(to_jsonb(hr)), '[]'::jsonb) from hr) as hourly,
      (select count(*) from w where status in ('running', 'waiting_review', 'waiting_answer'))::int as running,
      (select count(*) from w where status = 'needs_decision')::int as needs_decision,
      (select count(*) from w where status in ('failed', 'expired') and finished_at >= ${ts(win.since24)})::int as failed_24h,
      (select count(*) from w where
         (status in ('running', 'needs_decision') and updated_at <= ${ts(stuckBefore)})
         or (status in ('failed', 'expired') and finished_at <= ${ts(stuckBefore)} and finished_at >= ${ts(win.since7)}
             and not exists (select 1 from hub.process_runs x where x.rerun_of = w.id)))::int as stuck`,
  );
  return r[0] as RunsRow;
}

export type DifyRow = {
  errs: (Bucket & { n: number })[];
  calls_1h: number;
  errs_1h: number;
  errs_24h: number;
  failing_tools: number;
  top: { id: string; name: string; errors: number } | null;
};

/** Q2. Chỉ quét `dify_runs` 7 ngày (chỉ mục `dify_runs_created_at_idx`, migration hub 0100). */
export async function difyAgg(tx: Tx, win: Window): Promise<DifyRow> {
  const r = await rows<DifyRow>(
    tx,
    sql`
    with d as (
      select workflow_id, status, created_at,
        floor(extract(epoch from ${ts(win.now)} - created_at) / 86400)::int as k
      from hub.dify_run_stats where created_at >= ${ts(win.since7)} and created_at <= ${ts(win.now)}),
    ranked as (
      select workflow_id, status, row_number() over (partition by workflow_id order by created_at desc) as rn
      from d where created_at >= ${ts(win.since24)}),
    top as (
      select workflow_id, count(*)::int as n from d
      where status = 'failed' and created_at >= ${ts(win.since24)}
      group by workflow_id order by n desc, workflow_id limit 1)
    select
      (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n)), '[]'::jsonb)
         from (select k, count(*)::int as n from d where status = 'failed' group by k) x) as errs,
      (select count(*) from d where created_at >= ${ts(win.since1h)})::int as calls_1h,
      (select count(*) from d where created_at >= ${ts(win.since1h)} and status = 'failed')::int as errs_1h,
      (select count(*) from d where created_at >= ${ts(win.since24)} and status = 'failed')::int as errs_24h,
      (select count(*) from (select workflow_id from ranked where rn <= ${OVERVIEW_AI_TOOL_STREAK}
         group by workflow_id
         having count(*) = ${OVERVIEW_AI_TOOL_STREAK} and bool_and(status = 'failed')) f)::int as failing_tools,
      (select jsonb_build_object('id', t.workflow_id, 'name', coalesce(w.name, '?'), 'errors', t.n)
         from top t left join admin.workflows w on w.id = t.workflow_id) as top`,
  );
  return r[0] as DifyRow;
}

export type QuotaRow = {
  tenants_with_limit: number;
  limit_usd: number;
  used_usd: number;
  near: number;
  daily: (Bucket & { usd: number })[];
};

/**
 * Q3. Hạn mức TOÀN công ty (`feature_id is null`) của công ty khách đang hoạt động; % mỗi công ty = lớn nhất của các giới hạn đã đặt
 * (lượt chạy/token/USD — cùng cách `quotas.rules.quotaPct` của admin-api). USD/hạn mức USD chỉ cộng công ty có `max_usd`.
 */
export async function quotaAgg(
  tx: Tx,
  win: Window,
  month: { from: Date; to: Date },
  nearPct: number,
): Promise<QuotaRow> {
  const r = await rows<QuotaRow>(
    tx,
    sql`
    with q as (
      select q.tenant_id, q.max_runs, q.max_tokens, q.max_usd from admin.tenant_quotas q
      join admin.tenants tn on tn.id = q.tenant_id and tn.active and tn.key <> ${PLATFORM_TENANT_KEY}
      where q.feature_id is null),
    u as (
      select tenant_id, count(distinct run_id)::float8 as runs,
        coalesce(sum(input_tokens::bigint + output_tokens), 0)::float8 as tokens,
        coalesce(sum(billable_usd), 0)::float8 as usd
      from hub.usage_logs
      where at >= ${ts(month.from)} and at < ${ts(month.to)} and tenant_id in (select tenant_id from q)
      group by tenant_id),
    j as (
      select q.max_usd, coalesce(u.usd, 0) as usd,
        greatest(
          case when q.max_runs is not null then 100.0 * coalesce(u.runs, 0) / q.max_runs end,
          case when q.max_tokens is not null then 100.0 * coalesce(u.tokens, 0) / q.max_tokens end,
          case when q.max_usd is not null then 100.0 * coalesce(u.usd, 0) / q.max_usd end) as pct
      from q left join u on u.tenant_id = q.tenant_id)
    select
      (select count(*) from j where max_usd is not null)::int as tenants_with_limit,
      (select coalesce(sum(max_usd), 0)::float8 from j where max_usd is not null) as limit_usd,
      (select coalesce(sum(usd), 0)::float8 from j where max_usd is not null) as used_usd,
      (select count(*) from j where pct >= ${nearPct})::int as near,
      (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'usd', usd)), '[]'::jsonb) from (
         select floor(extract(epoch from ${ts(win.now)} - at) / 86400)::int as k,
           coalesce(sum(billable_usd), 0)::float8 as usd
         from hub.usage_logs where at >= ${ts(win.since7)} and at <= ${ts(win.now)} group by 1) x) as daily`,
  );
  return r[0] as QuotaRow;
}

export type CompaniesRow = { total: number; active_7d: number };

/** Q4. Hoạt động = có lượt chạy quy trình hoặc dòng dùng AI trong 7 ngày (`exists` theo chỉ mục (tenant_id, thời gian)). */
export async function companiesAgg(tx: Tx, win: Window): Promise<CompaniesRow> {
  const r = await rows<CompaniesRow>(
    tx,
    sql`
    with c as (select id from admin.tenants where active and key <> ${PLATFORM_TENANT_KEY})
    select (select count(*) from c)::int as total,
      (select count(*) from c where
         exists (select 1 from hub.process_runs r where r.tenant_id = c.id and r.started_at >= ${ts(win.since7)})
         or exists (select 1 from hub.usage_logs l where l.tenant_id = c.id and l.at >= ${ts(win.since7)}))::int as active_7d`,
  );
  return r[0] as CompaniesRow;
}

export type InfraRow = {
  queued: number;
  oldest_wait_s: number | null;
  timer_overdue_s: number | null;
  slow_query_ms: number | null;
  connections: number;
  max_connections: number;
  size_bytes: number;
};

/** Q5. `jobs_claim_idx` (một phần `queued`), `process_timers_due_idx`; số liệu DB từ catalog (không quét bảng dữ liệu). */
export async function infraAgg(tx: Tx, now: Date): Promise<InfraRow> {
  const r = await rows<InfraRow>(
    tx,
    sql`
    select
      (select count(*) from hub.jobs where status = 'queued')::int as queued,
      (select extract(epoch from ${ts(now)} - min(created_at))::float8 from hub.jobs where status = 'queued') as oldest_wait_s,
      (select max(extract(epoch from ${ts(now)} - t.due_at))::float8 from hub.process_timers t
         where t.due_at < ${ts(now)} and t.fired_at is null and t.cancelled_at is null) as timer_overdue_s,
      (select (max(extract(epoch from clock_timestamp() - a.query_start)) * 1000)::float8
         from pg_stat_activity a where a.state = 'active' and a.pid <> pg_backend_pid()
           and a.datname = current_database()) as slow_query_ms,
      (select count(*) from pg_stat_activity a where a.datname = current_database())::int as connections,
      current_setting('max_connections')::int as max_connections,
      pg_database_size(current_database())::float8 as size_bytes`,
  );
  return r[0] as InfraRow;
}

export type CoverageRow = {
  status: string;
  value: {
    gap_count?: number;
    gaps?: { tenant: string }[];
    unrouted?: string[];
    broken?: string[];
  } | null;
};

/** Q6. Kết quả mới nhất của check `flow_coverage` (PK `check_key`); chưa chạy lượt kiểm nào ⇒ không có dòng. */
export async function flowCoverageLatest(tx: Tx): Promise<CoverageRow | null> {
  const r = await rows<CoverageRow>(
    tx,
    sql`select status, value from hub.ops_checks where check_key = 'flow_coverage'`,
  );
  return r[0] ?? null;
}
