// CR-117 · ops-watch · nguồn số đo SLO: (1) DB hub (timer PD-P01, job dispatch) qua MỘT câu SQL chỉ đọc; (2) file `slo.json` do host ghi
// (tỷ lệ lỗi log, p95 route). Mỗi nguồn trả `null` khi không có số (thiếu/cũ/quá ít mẫu) — không bao giờ ném lỗi.
import { type OpsSloStatus, OpsSloStatusSchema } from "@ai/contracts/hub-admin";
import { sql } from "drizzle-orm";
import type { OpsDbPort } from "../../application/ops.check";
import { readStatusFile, type StatusFile, systemRead } from "./check-kit";

export type SloSamples = Record<string, number | null>;

export const MIN_LOG_LINES = 50;
export const MIN_ROUTE_REQS = 20;
export const SLO_WINDOW_MIN = 60;

export type SloDbRow = {
  dispatch_p50_ms: number | null;
  dispatch_n: number;
  timer_fired_p95_s: number | null;
  timer_overdue_s: number | null;
};

/**
 * Một câu, ba khối con: job dispatch trong cửa sổ (p50 queued→dispatched), trễ hẹn giờ đã bắn (p95 fired−due, lọc theo `due_at` =
 * chỉ mục `process_timers_due_idx`), và hẹn giờ đang quá hạn chưa bắn (trễ lớn nhất hiện tại).
 */
export const sloDbQuery = (since: string, now: string) => sql`
  select
    (select (percentile_cont(0.5) within group (order by extract(epoch from j.dispatched_at - j.queued_at)) * 1000)::float8
       from hub.jobs j where j.queued_at >= ${since}::timestamptz and j.dispatched_at is not null) as dispatch_p50_ms,
    (select count(*) from hub.jobs j where j.queued_at >= ${since}::timestamptz and j.dispatched_at is not null)::int as dispatch_n,
    (select percentile_cont(0.95) within group (order by extract(epoch from t.fired_at - t.due_at))::float8
       from hub.process_timers t where t.due_at >= ${since}::timestamptz and t.fired_at is not null) as timer_fired_p95_s,
    (select max(extract(epoch from ${now}::timestamptz - t.due_at))::float8
       from hub.process_timers t where t.due_at < ${now}::timestamptz and t.fired_at is null and t.cancelled_at is null) as timer_overdue_s`;

const rounded = (v: number): number => Math.round(v * 100) / 100;

/** Thuần. Job dispatch cần ≥ 1 mẫu; trễ timer = lớn hơn của p95 đã bắn và trễ hiện tại (hẹn giờ kẹt cũng tính). */
export function samplesFromDb(r: SloDbRow | undefined): SloSamples {
  if (!r) return { chat_dispatch_p50: null, timer_lag_p95: null };
  const fired = r.timer_fired_p95_s;
  const over = r.timer_overdue_s;
  const lag = fired === null && over === null ? null : Math.max(fired ?? 0, over ?? 0, 0);
  return {
    chat_dispatch_p50:
      r.dispatch_n > 0 && r.dispatch_p50_ms !== null ? rounded(r.dispatch_p50_ms) : null,
    timer_lag_p95: lag === null ? null : rounded(lag),
  };
}

/** Thuần. File host cũ hơn 2× cửa sổ ⇒ coi như không có số; log ít hơn `MIN_LOG_LINES` dòng ⇒ không tính tỷ lệ. */
export function samplesFromHost(f: StatusFile<OpsSloStatus>, now: Date): SloSamples {
  const none: SloSamples = { log_error_rate: null, contracts_list_p95: null };
  if (f.kind !== "ok") return none;
  const age = now.getTime() - Date.parse(f.data.at);
  if (age > 2 * f.data.window_min * 60_000) return none;
  const { lines, errors } = f.data.log;
  const route = f.data.routes?.["contracts.list"];
  return {
    log_error_rate: lines >= MIN_LOG_LINES ? rounded((errors / lines) * 100) : null,
    contracts_list_p95: route && route.n >= MIN_ROUTE_REQS ? rounded(route.p95_ms) : null,
  };
}

export async function collectSamples(d: {
  db: OpsDbPort;
  now: Date;
  statusDir?: string;
}): Promise<SloSamples> {
  const since = new Date(d.now.getTime() - SLO_WINDOW_MIN * 60_000).toISOString();
  const [rows, file] = await Promise.all([
    systemRead(d.db, (tx) => tx.execute<SloDbRow>(sloDbQuery(since, d.now.toISOString()))),
    readStatusFile(d, "slo.json", OpsSloStatusSchema),
  ]);
  return { ...samplesFromDb(rows[0]), ...samplesFromHost(file, d.now) };
}
