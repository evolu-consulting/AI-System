// CR-104 · ops-checks · "Run AI thất bại": `hub.runs` 60 phút qua (≥ 10 run ⇒ % failed so ngưỡng warn); crit khi số run
// `ALL_PROVIDERS_EXHAUSTED` kết thúc trong 30 phút qua > ngưỡng crit (mặc định 0). Một câu SQL tổng hợp (không theo hàng).

import { sql } from "drizzle-orm";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead, thresholds } from "./check-kit";

export const RUNS_MIN_SAMPLE = 10;

export type RunsAgg = { total: number; failed: number; exhausted: number };

const HINT_EXHAUSTED =
  "Mọi provider đang không phục vụ được: xem check Provider AI, đăng nhập lại Claude CLI trên host (gen-env.sh) hoặc chờ hết cooldown.";
const HINT_RATE =
  "Nhiều run thất bại: mở trang Run trong ai-admin xem mã lỗi gần nhất (TIMEOUT/UPSTREAM_ERROR); kiểm tra provider và agent-runtime.";

/** Thuần. `warnPct`: % failed; `critCount`: số exhausted cho phép (crit khi lớn hơn). */
export function evaluateRunsFailed(a: RunsAgg, warnPct: number, critCount: number): OpsCheckResult {
  const pct = a.total >= RUNS_MIN_SAMPLE ? Math.round((a.failed / a.total) * 100) : null;
  const value = { total: a.total, failed: a.failed, failed_pct: pct, exhausted_30m: a.exhausted };
  if (a.exhausted > critCount)
    return {
      status: "crit",
      value,
      message: `${a.exhausted} run thất bại do mọi provider không phục vụ được (30 phút qua)`,
      hint: HINT_EXHAUSTED,
    };
  if (pct !== null && pct > warnPct)
    return {
      status: "warn",
      value,
      message: `${pct}% run thất bại trong 1 giờ qua (${a.failed}/${a.total})`,
      hint: HINT_RATE,
    };
  return {
    status: "ok",
    value,
    message:
      pct === null
        ? `Chỉ ${a.total} run trong 1 giờ qua (chưa đủ ${RUNS_MIN_SAMPLE} để tính %)`
        : `${pct}% run thất bại trong 1 giờ qua (${a.failed}/${a.total})`,
  };
}

/** Một câu, hai nhánh dùng chỉ mục (`runs_started_at_idx`, `runs_exhausted_finished_idx` — migration 0065); không `OR` để tránh quét toàn bảng. */
export const runsAggQuery = (h: string, m: string) => sql`
  select t.total, t.failed,
    (select count(*) from hub.runs where status = 'failed' and error_code = 'ALL_PROVIDERS_EXHAUSTED'
       and finished_at >= ${m}::timestamptz)::int as exhausted
  from (select count(*)::int as total, (count(*) filter (where status = 'failed'))::int as failed
        from hub.runs where started_at >= ${h}::timestamptz) t`;

export const runsFailedCheck: OpsCheck = {
  key: "runs_failed",
  async run(d, cfg) {
    const t = thresholds("runs_failed", cfg);
    const h = new Date(d.now.getTime() - 60 * 60_000).toISOString();
    const m = new Date(d.now.getTime() - 30 * 60_000).toISOString();
    const [r] = await systemRead(d.db, (tx) => tx.execute<RunsAgg>(runsAggQuery(h, m)));
    return evaluateRunsFailed(
      r ?? { total: 0, failed: 0, exhausted: 0 },
      t.warn ?? 20,
      t.crit ?? 0,
    );
  },
};
