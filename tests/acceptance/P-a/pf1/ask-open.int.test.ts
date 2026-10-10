// HUB-FR-110 · AC-H30 · P1-37…P1-39 (test-plan-int §2; plan-step0 §1: mở task ask là PF1; C4 excerpt; D7 gộp câu hỏi nhóm):
// runtime `need_input` ⇒ stage `waiting_answer`, job kết thúc (không giữ slot), task ask open + assignee theo `answerer`,
// `asks_count` tăng, `attempt` giữ; lần 4 ⇒ needs_decision `ask_limit`; nhóm `parallel_merge` 2 câu hỏi ⇒ đúng 1 task ask.
// Trả lời (PF2) không kiểm ở đây. Trước code: đỏ ở `needSchema`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { type Json, PA, type Sql, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  type Job,
  jobAsk,
  nextStageJob,
  openTask,
  P1,
  runRow,
  stageRow,
  startInRoom,
  startPf1,
  waitStatus,
} from "./_local";

let c: CtxPf1;
beforeAll(async () => {
  c = await startPf1();
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settleAll(c.sql);
});
afterAll(async () => {
  await c?.stop();
});

async function settleAll(sql: Sql): Promise<void> {
  await sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}
const askEvents = (runId: string) =>
  c.sql<
    Json[]
  >`select kind, meta from hub.process_thread_events where process_run_id = ${runId} and kind = 'ask'`;
const askTasks = (runId: string) =>
  c.sql<Json[]>`select * from hub.review_tasks where process_run_id = ${runId} and kind = 'ask'`;

describe("P1-37…P1-39 · mở task ask [HUB-FR-110]", () => {
  it("AC-H30 · P1-37 · need_input ⇒ waiting_answer, job kết thúc, task ask (question, choices, excerpt 1 000 ký tự, assignee A), asks_count=1, attempt giữ, sự kiện thread ask", async () => {
    needSchema(c.ready);
    const input = "HD-".padEnd(1500, "x");
    const s = await startInRoom(c, { input });
    const j = await nextStageJob(c, s.runId);
    await jobAsk(c, j, "Định dạng ngày?", ["dd/mm", "ISO"]);
    await waitStatus(c.sql, s.runId, "waiting_answer");
    const st = await stageRow(c.sql, s.runId, 0);
    expect(st).toMatchObject({ status: "waiting_answer", asks_count: 1, attempt: 1 });
    const [hr] = await c.sql<Json[]>`select status from hub.runs where id = ${j.runId}`;
    expect(hr?.status).not.toBe("running");
    const [job] = await c.sql<Json[]>`select status from hub.jobs where id = ${j.id}`;
    expect(["queued", "running"]).not.toContain(job?.status);
    const t = await openTask(c.sql, s.runId, "ask");
    expect(t).toMatchObject({ question: "Định dạng ngày?", status: "open" });
    expect(t?.choices).toEqual(["dd/mm", "ISO"]);
    expect(t?.excerpt).toBe(input.slice(0, 1000));
    const asg = await c.sql<
      Json[]
    >`select user_id, group_id from hub.review_task_assignees where task_id = ${t?.id}`;
    expect([...asg]).toEqual([{ user_id: PA.A.id, group_id: null }]);
    const evs = await askEvents(s.runId);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.meta).toMatchObject({
      kind: "ask",
      task_id: t?.id,
      asks_count: 1,
      ask_limit: 3,
    });
  }, 30_000);

  it("AC-H30 · P1-38 · need_input lần 4 (SQL asks_count=3) ⇒ needs_decision ask_limit, attempt giữ; A decide add_attempt ⇒ ask_limit=4, stage queued", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c);
    const j = await nextStageJob(c, s.runId);
    await c.sql`update hub.stage_runs set asks_count = 3 where process_run_id = ${s.runId} and stage_idx = 0`;
    await jobAsk(c, j, "Kỳ kế toán nào?", ["Tháng 9", "Tháng 10"]);
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await runRow(c.sql, s.runId)).decision?.reason).toBe("ask_limit");
    expect((await stageRow(c.sql, s.runId, 0)).attempt).toBe(1);
    expect(await openTask(c.sql, s.runId, "ask")).toBeUndefined();
    const r = await c.call("A", "POST", `/process-runs/${s.runId}/decide`, {
      option: "add_attempt",
    });
    expect(r.status).toBe(200);
    const st = await stageRow(c.sql, s.runId, 0);
    expect(st.ask_limit).toBe(4);
    // `queued` ngay sau quyết; launcher thật có thể đã kick ⇒ `running`.
    expect(["queued", "running"]).toContain(st.status);
    expect((await runRow(c.sql, s.runId)).status).toBe("running");
  }, 30_000);

  it("HUB-FR-110 · P1-39 · D7 parallel_merge 2 thành viên need_input ⇒ đúng 1 task ask (câu gộp có vai), team waiting_answer, 1 sự kiện thread ask", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: DEFS.pm.key });
    const j1 = await nextStageJob(c, s.runId);
    const j2 = await nextStageJob(c, s.runId);
    const byAgent = new Map<string, Job>([j1, j2].map((j) => [j.payload.agent.id, j]));
    expect([...byAgent.keys()].sort()).toEqual([P1.agM1, P1.agM2].sort());
    await jobAsk(c, byAgent.get(P1.agM1) as Job, "Phạm vi phân tích?", ["Hẹp", "Rộng"]);
    await jobAsk(c, byAgent.get(P1.agM2) as Job, "Kiểu sơ đồ?", ["UML", "C4"]);
    await waitStatus(c.sql, s.runId, "waiting_answer");
    const tasks = await waitFor(
      () => askTasks(s.runId),
      (v) => v.length >= 1,
      5_000,
    );
    expect(tasks).toHaveLength(1);
    const q = String(tasks[0]?.question);
    for (const part of ["Phạm vi phân tích?", "Kiểu sơ đồ?", "Phân tích", "Thiết kế"])
      expect(q).toContain(part);
    const [tr] = await c.sql<
      Json[]
    >`select status from hub.team_runs where process_run_id = ${s.runId}`;
    expect(tr?.status).toBe("waiting_answer");
    expect(await askEvents(s.runId)).toHaveLength(1);
  }, 30_000);
});
