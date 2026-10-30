// CR-104 · ops-checks · "Hàng đợi / run kẹt": job `orphaned` (failed, 60 phút qua) + run quy trình còn `running` dù đã quá hạn
// (`expires_at`). Tổng > warn ⇒ warn, > crit ⇒ crit. Một câu SQL (hai đếm con).

import { sql } from "drizzle-orm";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead, thresholds } from "./check-kit";

export type StuckAgg = { orphaned: number; overdue_runs: number };

const HINT =
  "Xem `docker compose logs --tail 100 agent-runtime hub-api`; khởi động lại agent-runtime nếu worker chết, rồi huỷ/chạy lại run quy trình bị kẹt trong ai-admin.";

/** Thuần. */
export function evaluateStuck(a: StuckAgg, warn: number, crit: number): OpsCheckResult {
  const total = a.orphaned + a.overdue_runs;
  const value = { total, orphaned_jobs: a.orphaned, overdue_process_runs: a.overdue_runs };
  const message = `${a.orphaned} job orphaned (1 giờ qua), ${a.overdue_runs} run quy trình quá hạn`;
  if (total > crit) return { status: "crit", value, message, hint: HINT };
  if (total > warn) return { status: "warn", value, message, hint: HINT };
  return { status: "ok", value, message: total === 0 ? "Không có job/run kẹt" : message };
}

/** Hai đếm con, mỗi đếm một chỉ mục từng phần (`jobs_orphaned_finished_idx`, `process_runs_running_expires_idx` — migration hub 0066_ops_indexes). */
export const stuckQuery = (since: string, now: string) => sql`
  select
    (select count(*) from hub.jobs where error_reason = 'orphaned' and finished_at >= ${since}::timestamptz)::int as orphaned,
    (select count(*) from hub.process_runs where status = 'running' and expires_at < ${now}::timestamptz)::int as overdue_runs`;

export const stuckCheck: OpsCheck = {
  key: "stuck",
  async run(d, cfg) {
    const t = thresholds("stuck", cfg);
    const since = new Date(d.now.getTime() - 60 * 60_000).toISOString();
    const [r] = await systemRead(d.db, (tx) =>
      tx.execute<StuckAgg>(stuckQuery(since, d.now.toISOString())),
    );
    return evaluateStuck(r ?? { orphaned: 0, overdue_runs: 0 }, t.warn ?? 0, t.crit ?? 5);
  },
};
