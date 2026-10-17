// AC-H41 · AC-H39 · HUB-FR-143/144 · fixture SQL hàng loạt (test-plan-int §9 + PD-I39d, plan-db §1): N run `running` có
// stage 0 `waiting_timer` (đã thử lại 1 lần) + 1 hẹn `retry` tới hạn mỗi stage. Bulk insert (chia lô) thay `insertRun` từng
// hàng. CHỈ gọi sau `needPdSchema` (bảng/cột 0036). jsonb qua `sql.json`. Không chứa `it(...)`.
import type { Json, Sql } from "../_support/pd";

let seq = 0;
/** uuid tất định dải `a5d2…` (không trùng giữa các lần gọi trong cùng tiến trình). */
const gid = () => `a5d20000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

type Def = { id: string; key: string; name: string; stages: readonly Json[] };
type Who = { id: string; tid: string };
const CHUNK = 250;

async function insertChunked(sql: Sql, table: string, rows: Json[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK)
    await sql`insert into ${sql(table)} ${sql(rows.slice(i, i + CHUNK))}`;
}

/**
 * `n` run của `who` theo `def` (1 stage được dùng: stage 0): run `running`, stage 0 `waiting_timer` (`retry_count` 1,
 * `retry_attempt`/`retry_round` 1, `last_error_code` UPSTREAM_ERROR), hẹn `retry` `due_at = dueAt`, khoá `retry:<sr>:1:1:1`.
 * Trả `{runIds, stageRunIds}` theo cùng thứ tự.
 */
export async function insertDueRetries(
  sql: Sql,
  o: { def: Def; who: Who; n: number; dueAt: Date; now: Date },
): Promise<{ runIds: string[]; stageRunIds: string[] }> {
  const tid = o.who.tid;
  const convs: Json[] = [];
  const flows: Json[] = [];
  const runs: Json[] = [];
  const stages: Json[] = [];
  const timers: Json[] = [];
  const snapshot = sql.json({
    key: o.def.key,
    name: o.def.name,
    stages: o.def.stages as Json[],
    token_budget: null,
    run_group_ids: [],
  });
  for (let i = 0; i < o.n; i++) {
    const [runId, convId, flowId, srId] = [gid(), gid(), gid(), gid()];
    convs.push({
      id: convId,
      tenant_id: tid,
      user_id: o.who.id,
      title: o.def.name,
      title_norm: o.def.name.toLowerCase(),
      process_run_id: runId,
    });
    flows.push({
      id: flowId,
      tenant_id: tid,
      user_id: o.who.id,
      conversation_id: convId,
      title: o.def.name,
      message_count: 1,
    });
    runs.push({
      id: runId,
      tenant_id: tid,
      process_def_id: o.def.id,
      def_version: 1,
      snapshot,
      started_by: o.who.id,
      origin_kind: "admin",
      origin_room_id: null,
      input: `HS-${i}`,
      conversation_id: convId,
      flow_id: flowId,
      status: "running",
      current_stage_idx: 0,
      decision: null,
      expires_at: new Date(o.now.getTime() + 7 * 86_400_000),
      started_at: o.now,
      updated_at: o.now,
      finished_at: null,
    });
    stages.push({
      id: srId,
      tenant_id: tid,
      process_run_id: runId,
      stage_idx: 0,
      status: "waiting_timer",
      retry_count: 1,
      retry_attempt: 1,
      retry_round: 1,
      last_error_code: "UPSTREAM_ERROR",
    });
    timers.push({
      tenant_id: tid,
      process_run_id: runId,
      stage_run_id: srId,
      kind: "retry",
      due_at: o.dueAt,
      timezone: null,
      idempotency_key: `retry:${srId}:1:1:1`,
    });
  }
  await insertChunked(sql, "hub.conversations", convs);
  await insertChunked(sql, "hub.flows", flows);
  await insertChunked(sql, "hub.process_runs", runs);
  // stage còn lại của def (nếu có) ở `pending` — bất biến 1 hàng/stage như `insertRun`.
  for (let k = 1; k < o.def.stages.length; k++)
    for (const r of runs)
      stages.push({
        id: gid(),
        tenant_id: tid,
        process_run_id: r.id,
        stage_idx: k,
        status: "pending",
      });
  await insertChunked(
    sql,
    "hub.stage_runs",
    stages.filter((s) => s.stage_idx === 0),
  );
  const rest = stages.filter((s) => s.stage_idx !== 0);
  if (rest.length > 0) await insertChunked(sql, "hub.stage_runs", rest);
  await insertChunked(sql, "hub.process_timers", timers);
  return {
    runIds: runs.map((r) => r.id as string),
    stageRunIds: stages.filter((s) => s.stage_idx === 0).map((s) => s.id as string),
  };
}

/** Đếm theo tập stage: số hẹn đã bắn, số hẹn bắn trùng (>1 hàng fired / stage), số job, stage có > 1 job. */
export async function fireStats(
  sql: Sql,
  stageRunIds: string[],
): Promise<{ fired: number; open: number; jobs: number; dupJobs: number; noJob: number }> {
  const ids = sql.array(stageRunIds, 2950);
  const [t] = await sql<{ fired: number; open: number }[]>`select
      count(*) filter (where fired_at is not null)::int as fired,
      count(*) filter (where fired_at is null and cancelled_at is null)::int as open
    from hub.process_timers where stage_run_id = any(${ids})`;
  const per = await sql<
    { n: number }[]
  >`select count(j.id)::int as n from unnest(${ids}::uuid[]) s(id)
    left join hub.runs r on r.stage_run_id = s.id left join hub.jobs j on j.run_id = r.id group by s.id`;
  return {
    fired: t?.fired ?? 0,
    open: t?.open ?? 0,
    jobs: per.reduce((a, r) => a + r.n, 0),
    dupJobs: per.filter((r) => r.n > 1).length,
    noJob: per.filter((r) => r.n === 0).length,
  };
}

/** p-quantile (0…1) của mảng số (ms). */
export function quantile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0;
}
