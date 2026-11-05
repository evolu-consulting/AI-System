// CR-121 · cr121-c3a-overview-api · `GET /ops/overview` — gộp 6 câu SQL theo tập (`overview.repo`) + file host (`host.json`) thành
// `OpsOverview`. Cache 60 giây TRONG process theo (stuck_hours, quota_pct), có chống dẫm chân (nhiều request cùng lúc dùng chung
// một lượt tính). Không HTTP. Vai (platform_admin) kiểm ở route TRƯỚC khi vào đây; service chỉ đọc, không ghi.

import type { Role } from "@ai/contracts";
import {
  OpsHostStatusSchema,
  type OpsOverview,
  type OpsOverviewQuery,
  OVERVIEW_AI_TOOL_STREAK,
  OVERVIEW_CACHE_TTL_S,
} from "@ai/contracts/hub-admin";
import type { Db } from "../../../lib/db";
import { appError } from "../../../lib/errors";
import { readStatusFile, systemRead } from "../adapters/checks/check-kit";
import {
  companiesAgg,
  difyAgg,
  flowCoverageLatest,
  infraAgg,
  quotaAgg,
  runsAgg,
  type Window,
} from "../adapters/overview.repo";
import {
  atWindow,
  type Cached,
  cacheKey,
  DAY_MS,
  dailySeries,
  fresh,
  HOUR_MS,
  halfConfigured,
  hourlyColumns,
  minutesOf,
  monthWindow,
  queueLagSeconds,
  ratePct,
  unroutedCompanies,
  usedPct,
} from "../domain/overview.rules";

export type OverviewDeps = { db: Db; statusDir?: string; now?: () => Date };

/** Đích các mục "Cần xử lý ngay" (trang đích + bộ lọc do màn hình Tổng quan/UI lát sau đảm nhiệm). */
export const OVERVIEW_LINKS = {
  runs: "/runs?filter=attention",
  companies: "/tenants?filter=unrouted",
  aiTools: "/workflows?filter=failing",
  quota: "/tenants?filter=near_quota",
  config: "/system",
} as const;

const num = (x: number | null | undefined): number =>
  x === null || x === undefined ? 0 : Number(x);
const usd = (x: number): number => Math.round(x * 100) / 100;

async function compute(d: OverviewDeps, p: OpsOverviewQuery, now: Date): Promise<OpsOverview> {
  const win: Window = {
    now,
    since1h: new Date(now.getTime() - HOUR_MS),
    since24: new Date(now.getTime() - DAY_MS),
    since7: new Date(now.getTime() - 7 * DAY_MS),
  };
  const stuckBefore = new Date(now.getTime() - p.stuck_hours * HOUR_MS);
  const [host, q] = await Promise.all([
    readStatusFile(d, "host.json", OpsHostStatusSchema),
    systemRead(d.db, async (tx) => {
      const runs = await runsAgg(tx, win, stuckBefore);
      const dify = await difyAgg(tx, win);
      const quota = await quotaAgg(tx, win, monthWindow(now), p.quota_pct);
      const cos = await companiesAgg(tx, win);
      const t0 = performance.now();
      const infra = await infraAgg(tx, now);
      const pingMs = Math.round(performance.now() - t0);
      const cov = await flowCoverageLatest(tx);
      return { runs, dify, quota, cos, infra, pingMs, cov };
    }),
  ]);
  const { runs, dify, quota, cos, infra, pingMs, cov } = q;

  const started = dailySeries(runs.started, (r) => r.n, 0);
  const finEnded = dailySeries(runs.finished, (r) => r.ended, 0);
  const finFailed = dailySeries(runs.finished, (r) => r.failed, 0);
  const rate = finEnded.map((e, i) => ratePct(finFailed[i] as number, e));
  const p95 = dailySeries<(typeof runs.finished)[number], number | null>(
    runs.finished,
    (r) => minutesOf(r.p95_s),
    null,
  );
  const doneN = dailySeries(runs.finished, (r) => r.done, 0);
  const aiErr = dailySeries(dify.errs, (r) => r.n, 0);
  const cost = dailySeries(quota.daily, (r) => usd(r.usd), 0);
  const coSeries = dailySeries(runs.started, (r) => r.c, 0);
  const hostOk = host.kind === "ok" ? host.data : null;
  const cfgCount = halfConfigured(cov?.value ?? null);

  return {
    generated_at: now.toISOString(),
    cache_ttl_s: OVERVIEW_CACHE_TTL_S,
    params: p,
    kpi: {
      runs: {
        value: atWindow(started, 0),
        yesterday: atWindow(started, 1),
        running: runs.running,
        failed: runs.failed_24h,
        needs_decision: runs.needs_decision,
        series: started,
      },
      error_rate: {
        value: atWindow(rate, 0),
        yesterday: atWindow(rate, 1),
        ended: atWindow(finEnded, 0),
        failed: atWindow(finFailed, 0),
        series: rate,
      },
      p95: {
        minutes: atWindow(p95, 0),
        yesterday_minutes: atWindow(p95, 1),
        n: atWindow(doneN, 0),
        p95_basis: "excluding_review_wait",
        series: p95,
      },
      ai_tool_errors: {
        value: dify.errs_24h,
        yesterday: atWindow(aiErr, 1),
        series: aiErr,
      },
      ai_quota: {
        used_pct: usedPct(num(quota.used_usd), num(quota.limit_usd)),
        used_usd: usd(num(quota.used_usd)),
        limit_usd: usd(num(quota.limit_usd)),
        tenants_with_limit: quota.tenants_with_limit,
        series: cost,
      },
      companies: { active_7d: cos.active_7d, total: cos.total, series: coSeries },
    },
    hourly: hourlyColumns(runs.hourly, now),
    attention: {
      stuck_runs: { count: runs.stuck, hours: p.stuck_hours, link: OVERVIEW_LINKS_RUNS(p) },
      unrouted_companies: {
        count: unroutedCompanies(cov?.value ?? null),
        link: OVERVIEW_LINKS.companies,
      },
      failing_ai_tools: {
        count: dify.failing_tools,
        streak: OVERVIEW_AI_TOOL_STREAK,
        link: OVERVIEW_LINKS.aiTools,
      },
      near_quota_companies: { count: quota.near, pct: p.quota_pct, link: OVERVIEW_LINKS.quota },
      half_configured: { count: cfgCount, link: OVERVIEW_LINKS.config },
    },
    health: {
      queue: {
        lag_s: queueLagSeconds(infra.oldest_wait_s, infra.timer_overdue_s),
        queued: infra.queued,
        oldest_wait_s: Math.round(num(infra.oldest_wait_s)),
        timer_overdue_s: Math.round(num(infra.timer_overdue_s)),
      },
      dify: {
        error_rate_1h: ratePct(dify.errs_1h, dify.calls_1h),
        calls_1h: dify.calls_1h,
        errors_24h: dify.errs_24h,
        top_failing_tool: dify.top,
      },
      db: {
        ok: true,
        ping_ms: pingMs,
        slow_query_ms: infra.slow_query_ms === null ? null : Math.round(infra.slow_query_ms),
        connections: infra.connections,
        max_connections: infra.max_connections,
        size_bytes: Math.round(num(infra.size_bytes)),
      },
      deploy: { version: hostOk?.deploy_ref ?? null, checked_at: hostOk?.at ?? null },
    },
  };
}

const OVERVIEW_LINKS_RUNS = (p: OpsOverviewQuery): string =>
  `${OVERVIEW_LINKS.runs}&hours=${p.stuck_hours}`;

export type OverviewService = { get(p: OpsOverviewQuery, role: Role): Promise<OpsOverview> };

/** Cache theo tham số + một lượt tính đang bay mỗi khoá. Lỗi không được cache (lần sau tính lại). */
export function makeOverviewService(d: OverviewDeps): OverviewService {
  const clock = d.now ?? (() => new Date());
  const cache = new Map<string, Cached<OpsOverview>>();
  const flying = new Map<string, Promise<OpsOverview>>();
  return {
    async get(p, role) {
      // Vai kiểm ngay trong service (không chỉ dựa vào route): không phải platform_admin ⇒ 403 trước mọi đọc DB/cache.
      if (role !== "platform_admin") throw appError("FORBIDDEN");
      const key = cacheKey(p);
      const now = clock();
      const hit = cache.get(key);
      if (fresh(hit, now.getTime(), OVERVIEW_CACHE_TTL_S * 1000)) return hit.value;
      const inflight = flying.get(key);
      if (inflight) return inflight;
      const run = compute(d, p, now)
        .then((value) => {
          cache.set(key, { at: now.getTime(), value });
          return value;
        })
        .finally(() => flying.delete(key));
      flying.set(key, run);
      return run;
    },
  };
}
