// HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · hạ tầng chạy quy trình K1 (test-plan K1 §2): bắt đầu run ở phòng R, claim job stage
// bằng Runtime giả, trả output, chấm gate, gọi `kh-query` qua `/mcp` bằng token job, đọc `kh_writes`/`kh_stage_usage`.
// Dùng lại helper PF1 (`jobDone`, `review`) và H2a (`toolCall`, `rpcRaw`) — chỉ cần `sql`/`rt`/`call`/`base` (ép kiểu).
// Không chứa `it(...)`.
import { expect } from "bun:test";
import { rpcRaw, toolCall } from "../H2a/_h2a2";
import { jobDone as pf1Done, review as pf1Review } from "../P-a/pf1/_local";
import { cm } from "../X2a/_x2a";
import {
  type CtxK1,
  type Job,
  type Json,
  jobToken,
  PA_FIX,
  type Role,
  type Sql,
  waitFor,
} from "./_k1";

export const KH_TOOL = "kh-query";

/** A gửi `!<key> …` ở phòng R ⇒ id process run (đòi 201 + header). */
export async function startRun(c: CtxK1, key: string, role: Role = "A"): Promise<string> {
  const res = await c.call(role, "POST", `/rooms/${PA_FIX.room}/messages`, {
    client_msg_id: cm(),
    content: `!${key} HD-12 tháng 9`,
  });
  expect({ status: res.status }).toEqual({ status: 201 });
  const id = res.headers.get("x-process-run-id");
  expect(id).toBeTruthy();
  return id as string;
}

/** Job `queued` của stage `idx` (chờ ≤ ms) rồi claim. */
export async function stageJob(c: CtxK1, runId: string, idx: number, ms = 8_000): Promise<Job> {
  const row = await waitFor(
    async () =>
      (
        await c.sql<{ run_id: string }[]>`select j.run_id from hub.jobs j
          join hub.runs r on r.id = j.run_id join hub.stage_runs sr on sr.id = r.stage_run_id
          where r.process_run_id = ${runId} and sr.stage_idx = ${idx} and j.status = 'queued'
          order by j.created_at limit 1`
      )[0],
    (v) => v !== undefined,
    ms,
  );
  expect({ stage: idx, queuedJob: row !== undefined }).toEqual({ stage: idx, queuedJob: true });
  return c.rt.next((row as { run_id: string }).run_id);
}

export const done = (c: CtxK1, job: Job, md: string) => pf1Done(c as never, job, md);

export async function stageRow(sql: Sql, runId: string, idx: number): Promise<Json> {
  const [r] =
    await sql`select * from hub.stage_runs where process_run_id = ${runId} and stage_idx = ${idx}`;
  return r ? { ...r } : undefined;
}
export async function waitStage(sql: Sql, runId: string, idx: number, status: string, ms = 8_000) {
  const r = await waitFor(
    () => stageRow(sql, runId, idx),
    (v) => v?.status === status,
    ms,
  );
  expect({ stage: idx, status: r?.status }).toEqual({ stage: idx, status });
  return r;
}
export async function runRow(sql: Sql, runId: string): Promise<Json> {
  const [r] = await sql`select * from hub.process_runs where id = ${runId}`;
  return r ? { ...r } : undefined;
}
/** Chấm task review mở của stage `idx` (mặc định B — Kế toán). */
export async function decide(c: CtxK1, runId: string, idx: number, body: Json, who: Role = "B") {
  await waitStage(c.sql, runId, idx, "waiting_review");
  const [t] =
    await c.sql`select t.id from hub.review_tasks t join hub.stage_runs sr on sr.id = t.stage_run_id
    where t.process_run_id = ${runId} and sr.stage_idx = ${idx} and t.kind = 'review' and t.status = 'open'
    order by t.created_at desc limit 1`;
  expect(t?.id).toBeTruthy();
  const r = await pf1Review(c as never, who, t?.id, body);
  expect({ decision: r.status }).toEqual({ decision: 200 });
}

/** Chạy stage `idx` xong với `md` (auto ⇒ done). */
export async function finish(c: CtxK1, runId: string, idx: number, md: string): Promise<Job> {
  const j = await stageJob(c, runId, idx);
  await done(c, j, md);
  return j;
}

// ---------- /mcp ----------
export const mcpTools = (j: Job): string[] => ((j.payload as Json)?.mcp?.tools ?? []) as string[];
export const khQuery = (c: CtxK1, token: string, args: unknown) =>
  toolCall(c.hub as never, token, KH_TOOL, args);
export async function toolsList(c: CtxK1, token: string): Promise<Json[]> {
  const r = await rpcRaw(c.hub as never, token, {
    jsonrpc: "2.0",
    id: "tl-k1",
    method: "tools/list",
  });
  return (r.json?.result?.tools ?? []) as Json[];
}
export const toolText = (result: Json): string =>
  ((result?.content ?? []) as Json[]).map((x) => String(x?.text ?? "")).join("\n");

// ---------- bảng K1 ----------
export async function writesOf(sql: Sql, runId: string): Promise<Json[]> {
  const rows =
    await sql`select * from hub.kh_writes where process_run_id = ${runId} order by created_at, id`;
  return rows.map((r) => ({ ...r }));
}
export async function usageOf(sql: Sql, stageRunId: string): Promise<Json[]> {
  const rows = await sql`select * from hub.kh_stage_usage where stage_run_id = ${stageRunId}`;
  return rows.map((r) => ({ ...r }));
}
/** Đưa hàng chờ tới hạn ngay (thay cho chờ lùi 30 s × 2ⁿ). */
export const dueNow = (sql: Sql) =>
  sql`update hub.kh_writes set next_at = now() - interval '1 second' where status = 'pending'`;
/** View run (`GET /process-runs/:id`). */
export const viewOf = (c: CtxK1, who: Role, runId: string) =>
  c.call(who, "GET", `/process-runs/${runId}`);

/** Bỏ mọi run đang sống (giữa các ca; tránh quota/FLOW_BUSY) — như P-b2 `settleRuns`. */
export async function settle(sql: Sql): Promise<void> {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'cancelled', error_code = 'CANCELLED', error_message = 'qc settle',
      error_hint = 'qc settle', finished_at = now(), owner = null, lease_until = null
    where status in ('running', 'waiting')`;
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status not in ('done', 'cancelled', 'failed', 'expired')`;
  await sql`update hub.review_tasks set status = 'closed', result = 'cancelled', decided_at = now() where status = 'open'`;
}
/** Bắt đầu `key`, claim job stage `idx` (mặc định 0), gán token job. */
export async function runToJob(
  c: CtxK1,
  key: string,
  idx = 0,
): Promise<{ runId: string; job: Job; token: string; stageRunId: string }> {
  const runId = await startRun(c, key);
  const job = await stageJob(c, runId, idx);
  const token = await jobToken(c.sql, job);
  const sr = await stageRow(c.sql, runId, idx);
  return { runId, job, token, stageRunId: sr?.id };
}
