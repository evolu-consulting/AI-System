// HUB-FR-109 · HUB-FR-112 · HUB-BR-25 · AC-H31 · SC-2 (test-plan-int §7; plan D4; chỉ cổng merge PF4 + `done:pa`): mẫu seed
// `hoa-don` — bản tenant dev (acme) của `hub:seed` gán Group "Kế toán" (B, T) + bật. A "!hoa-don HD-12 12.000.000" ở R → stage 1
// output → T (ngoài phòng) Đạt từ thông báo DM → stage 2 hành động thật (`ghi-so`) chạy ĐÚNG 1 lần sau cổng: 1 job stage 2,
// `tool_confirmations` confirmed do Hub cấp (A không bị hỏi), audit `authorize_real_action` actor T. T sau `done` chỉ thấy việc
// mình; thread R: block · output s1 · task_result T (outside) · output s2 · run_end (5 tin).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../_support/schema";
import {
  PA,
  PA_FIX,
  runRow,
  type Scenario,
  seedReal,
  startScenario,
  until,
  waitTask,
} from "./_local";

// biome-ignore lint/suspicious/noExplicitAny: body JSON theo contract
type Json = any;
let c: Scenario;
let runId = "";

beforeAll(async () => {
  c = await startScenario();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("SC-2 · hoá đơn: hành động thật chạy đúng 1 lần sau cổng, người kiểm ngoài phòng [HUB-FR-109]", () => {
  it("HUB-FR-109 · AC-H31 · SC-2 · A bắt đầu ở R; T (ngoài phòng) Đạt từ thông báo DM ⇒ stage 2 chạy đúng 1 lần ⇒ run done", async () => {
    needSchema(c.ready);
    await seedReal(c);
    const start = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: crypto.randomUUID(),
      content: "!hoa-don HD-12 12.000.000",
    });
    expect(start.status).toBe(201);
    runId = start.headers.get("x-process-run-id") ?? "";
    expect(runId).not.toBe("");

    const task = await waitTask(c, runId, "review");
    expect(task).not.toBeNull();
    // stage 2 chưa chạy trước cổng
    expect(c.handled.filter((h) => h.processRunId === runId && h.stageIdx === 1)).toHaveLength(0);
    // T nhận thông báo DM "Cần bạn kiểm"
    const inbox = await until(
      () => c.call("T", "GET", "/me/process-inbox"),
      (r) =>
        ((r.json?.items ?? []) as Json[]).some(
          (n) => n.process_run_id === runId || n.process_run?.id === runId,
        ),
      10_000,
    );
    expect(inbox.status).toBe(200);
    const d = await c.call("T", "POST", `/review-tasks/${task?.id}/decision`, { result: "pass" });
    expect(d.status).toBe(200);

    const done = await until(
      () => runRow(c, runId),
      (r) => r?.status === "done",
      30_000,
    );
    expect(done?.status).toBe("done");
    expect(c.handled.filter((h) => h.processRunId === runId && h.stageIdx === 1)).toHaveLength(1);
  }, 120_000);

  it("HUB-FR-109 · D4 · SC-2 · hành động thật: confirmation do Hub cấp (không pending cho A), audit authorize_real_action actor T, mọi job user_id = A", async () => {
    needSchema(c.ready);
    expect(runId).not.toBe("");
    const pend = await c.sql<
      Json[]
    >`select tc.status from hub.tool_confirmations tc join hub.runs r on r.id = tc.run_id
      where r.process_run_id = ${runId}`;
    expect(pend.filter((p) => p.status === "pending")).toHaveLength(0);
    const audit = await c.sql<
      Json[]
    >`select actor_id from hub.audit_log where action = 'authorize_real_action'
      and (entity_id = ${runId} or summary->>'process_run_id' = ${runId})`;
    expect(audit.map((a) => a.actor_id)).toEqual([PA.T.id]);
    const jobs = c.handled.filter((h) => h.processRunId === runId);
    expect(jobs.length).toBe(2);
    expect(new Set(jobs.map((j) => j.userId))).toEqual(new Set([PA.A.id]));
  });

  it("HUB-BR-25 · SC-2 · T sau done chỉ thấy việc mình (access task, không tin phòng); thread R đúng 5 tin process, task_result T outside:true", async () => {
    needSchema(c.ready);
    const v = await c.call("T", "GET", `/process-runs/${runId}`);
    expect(v.status).toBe(200);
    expect(v.json?.access).toBe("task");
    expect((await c.call("T", "GET", `/rooms/${PA_FIX.room}/messages`)).status).toBe(404);
    const msgs = await until(
      () => c.sql<Json[]>`select process_kind, process_meta from hub.room_messages
        where process_run_id = ${runId} and sender_type = 'process' order by seq`,
      (m) => m.length >= 5,
      10_000,
    );
    expect(msgs.map((m) => m.process_kind)).toEqual([
      "block",
      "output",
      "task_result",
      "output",
      "run_end",
    ]);
    const tr = msgs.find((m) => m.process_kind === "task_result");
    expect(tr?.process_meta?.actor?.id).toBe(PA.T.id);
    expect(tr?.process_meta?.outside).toBe(true);
    expect(msgs.at(-1)?.process_meta?.status).toBe("done");
  });
});
