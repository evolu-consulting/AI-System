// AC-H39 · AC-H40 · HUB-FR-143 · HUB-BR-41 · helper riêng của `d1/retry.int` + `d1/team-retry.int` (test-plan-int §1–§2).
// Không chứa `it(...)`. Mọi ghi bảng 0036 chỉ gọi SAU `needPdSchema` trong `it` (hoặc `afterEach` khi `c.pd`).
// Mốc thời gian fixture lấy từ đồng hồ lệch `c.clk` (test-plan §1), không từ SQL `now()`.
import { expect } from "bun:test";
import {
  type CtxPd,
  createDef,
  DEFS,
  defBody,
  type Job,
  type Json,
  nextStageJob,
  PA,
  PD_DEFS,
  type Sql,
  stageOf,
  sweepN,
  T,
  timersOf,
  viewRun,
  waitFor,
} from "../_support/pd";

// ---------- def P-d qua API (một lần mỗi file; DB sạch theo `startPd`) ----------
const made = new WeakMap<CtxPd, Set<string>>();
/** `POST /process-defs` def mẫu nếu file này chưa tạo (gọi SAU `needPdSchema`). */
export async function ensureDef(c: CtxPd, name: "retry" | "par2"): Promise<string> {
  const body = PD_DEFS[name]();
  const s = made.get(c) ?? new Set<string>();
  made.set(c, s);
  if (!s.has(body.key)) {
    await createDef(c, body);
    s.add(body.key);
  }
  return body.key as string;
}

/**
 * Def `parallel_merge` cho P-d: nhóm `pm-team` có 2 thành viên (m1 → Phần A, m2 → Phần B) nên template/required_sections
 * chỉ gồm Phần A, Phần B (mục không ai phụ trách = lỗi cấu hình ⇒ 422). Không đụng fixture P-a `p-pm` (template 3 mục).
 */
export async function ensurePmDef(c: CtxPd): Promise<string> {
  const key = "pd-retry-pm";
  const s = made.get(c) ?? new Set<string>();
  made.set(c, s);
  if (!s.has(key)) {
    const st = DEFS.pm.stages[0] as Json;
    const output = {
      ...st.output,
      template: "## Phần A\n\n## Phần B\n",
      required_sections: ["Phần A", "Phần B"],
    };
    await createDef(c, defBody(key, [{ ...st, output }]));
    s.add(key);
  }
  return key;
}

// ---------- workflow `side_effect` cho PD-I06…I08 (D-PD03) ----------
const w = (n: number) => `a5d10000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
export const WF_PD = { secret: w(1), ghiSo: w(2), nhap: w(3) } as const;
/** Secret giả + 2 workflow: `ghi-so` (side_effect) và `ghi-nhap` (không side_effect). Không gọi Dify thật. */
export async function ensureWorkflows(sql: Sql): Promise<void> {
  await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4)
    values (${WF_PD.secret}, 'PD_QC_SECRET', ${Buffer.alloc(32, 7)}, ${Buffer.alloc(12, 1)}, 1, 'abcd')
    on conflict (id) do nothing`;
  const wf = (id: string, key: string, sideEffect: boolean) => ({
    id,
    key,
    name: `WFNAME-${key}-pd`,
    description: `Workflow thử P-d (${key}) cho ca side_effect.`,
    app_type: "workflow",
    base_url: "http://127.0.0.1:9",
    secret_id: WF_PD.secret,
    input_schema: sql.json([]),
    enabled: true,
    side_effect: sideEffect,
  });
  await sql`insert into admin.workflows ${sql([
    wf(WF_PD.ghiSo, "ghi-so", true),
    wf(WF_PD.nhap, "ghi-nhap", false),
  ])} on conflict (id) do nothing`;
}
/** Ghi 1 bước `tool` của workflow cho hub.run hiện tại của stage (như `mcp.repo.insertToolStep`). */
export async function insertToolStep(
  c: CtxPd,
  hubRunId: string,
  workflowId: string,
  status: "ok" | "skipped",
): Promise<void> {
  await c.sql`insert into hub.run_steps (tenant_id, user_id, run_id, seq, type, workflow_id, label_key, status,
      started_at, finished_at)
    select ${T.acme}, ${PA.A.id}, ${hubRunId}, coalesce(max(seq), 0) + 1, 'tool', ${workflowId}, 'tool.call',
      ${status}, ${c.clk.now()}, ${c.clk.now()}
    from hub.run_steps where run_id = ${hubRunId}`;
}

// ---------- hẹn + bắn ----------
export const retryTimers = async (sql: Sql, runId: string): Promise<Json[]> =>
  (await timersOf(sql, runId)).filter((t) => t.kind === "retry");
export const openRetry = async (sql: Sql, runId: string): Promise<Json[]> =>
  (await retryTimers(sql, runId)).filter((t) => t.fired_at === null && t.cancelled_at === null);
const ms = (v: unknown) => new Date(v as string).getTime();

/** Lỗi job ⇒ chờ stage `idx` rời `running`; trả {T0, T1, stage} (T0/T1 = đồng hồ lệch trước/sau lỗi). */
export async function failJob(
  c: CtxPd,
  runId: string,
  idx: number,
  how: () => Promise<void>,
): Promise<{ t0: number; t1: number; stage: Json }> {
  const t0 = c.clk.now().getTime();
  await how();
  const stage = await waitFor(
    () => stageOf(c.sql, runId, idx),
    (v) => v !== undefined && v.status !== "running" && v.status !== "queued",
    8_000,
  );
  return { t0, t1: c.clk.now().getTime(), stage: stage as Json };
}
/** Hẹn retry mở duy nhất của run có `due_at` ∈ [T0 + s, T1 + s]. */
export async function expectRetryDue(
  c: CtxPd,
  runId: string,
  f: { t0: number; t1: number },
  s: number,
) {
  const open = await openRetry(c.sql, runId);
  expect(open).toHaveLength(1);
  const due = ms(open[0]?.due_at);
  expect({ dueOk: due >= f.t0 + s * 1000 && due <= f.t1 + s * 1000 }).toEqual({ dueOk: true });
  return open[0] as Json;
}
/** Đặt đồng hồ tới `due_at + 50 ms` của hẹn mở rồi `sweepOnce` (trả kết quả sweep + hẹn). */
export async function fireOpen(c: CtxPd, runId: string): Promise<{ sweep: Json; timer: Json }> {
  const [t] = await openRetry(c.sql, runId);
  expect({ openRetry: t !== undefined }).toEqual({ openRetry: true });
  c.clk.set(new Date(ms(t?.due_at) + 50));
  return { sweep: await sweepN(c), timer: t as Json };
}
/** Bắn hẹn mở rồi nhận job mới của run. */
export async function fireAndTake(c: CtxPd, runId: string): Promise<Job> {
  await fireOpen(c, runId);
  return nextStageJob(c, runId);
}

/** Như P1-28: job + hub.run kết thúc 90 s trước (mốc = min(đồng hồ lệch, giờ thật) để sweep thấy dù đo theo nguồn nào). */
export async function interruptJob(c: CtxPd, job: Job): Promise<void> {
  const old = new Date(Math.min(c.clk.now().getTime(), Date.now()) - 90_000);
  await c.sql`update hub.jobs set status = 'succeeded', finished_at = ${old} where id = ${job.id}`;
  await c.sql`update hub.runs set status = 'finished', finished_at = ${old}, owner = null, lease_until = null
    where id = ${job.runId}`;
}

// ---------- đọc ----------
export async function viewStage(c: CtxPd, runId: string, idx: number): Promise<Json> {
  const v = await viewRun(c, "A", runId);
  expect(v.status).toBe(200);
  return (v.json?.stages as Json[] | undefined)?.find((s) => s.idx === idx);
}
export const teamRunsOf = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select * from hub.team_runs where process_run_id = ${runId} order by attempt, started_at`;
/** `hub.runs` của một stage_run (theo thứ tự tạo). */
export const hubRunsOfStage = (sql: Sql, stageRunId: string) =>
  sql<Json[]>`select id, status, error_code from hub.runs where stage_run_id = ${stageRunId}
    order by started_at, id`;
/** Hàng decision mở (cũ nhất trước). */
export const decisionsOf = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select t.*, s.stage_idx from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id
    where t.process_run_id = ${runId} and t.kind = 'decision' and t.status = 'open' order by t.created_at, t.id`;

// ---------- dọn giữa ca ----------
/** Huỷ hẹn mở (khi có 0036), đóng job/run treo, đưa process run còn hoạt động về `cancelled` (giữ sweep sạch). */
export async function settle(c: CtxPd): Promise<void> {
  if (c.pd)
    await c.sql`update hub.process_timers set cancelled_at = now()
      where fired_at is null and cancelled_at is null`;
  await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  if (c.pd)
    await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
      where status = 'waiting_timer'`;
  await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await c.sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}
