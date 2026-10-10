// HUB-FR-105…113 · HUB-BR-24 · HUB-BR-25 · SC-1 (test-plan-int §7; plan-seed `sdlc` 8 giai đoạn; chỉ cổng merge PF4 + `done:pa`):
// mẫu seed `sdlc` chép cho acme (PO = {B}, Tech lead = {B, T}), bật. A "!sdlc Thêm xuất CSV" ở R → Intake `need_input` → A nhờ H
// (note) → H trả lời → Intake output → B Đạt (cổng 1) → 2–4 tự chạy → 5 Sẵn sàng → T (ngoài phòng, qua `/me/review-tasks`) Chưa đạt
// "Thiếu ma trận luật" → 5 làm lại (attempt 2) → T Đạt (cổng 2) → 6–7 tự chạy → 8 Review → B Đạt (cổng 3) ⇒ run `done`.
// Hub thật không seam + Runtime giả tự động (`_local.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../_support/schema";
import {
  copyTemplate,
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
let flowId = "";

beforeAll(async () => {
  c = await startScenario();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const pass = (r: "B" | "T", taskId: string) =>
  c.call(r, "POST", `/review-tasks/${taskId}/decision`, { result: "pass" });

describe("SC-1 · sdlc 3 cổng + hỏi lại + nhờ trả lời + Chưa đạt ở Sẵn sàng [HUB-FR-105…113]", () => {
  it("HUB-FR-105 · SC-1 · chạy trọn sdlc qua API: 3 cổng (B, T, B), Intake hỏi lại nhờ H, Sẵn sàng Chưa đạt ⇒ attempt 2 ⇒ run done", async () => {
    needSchema(c.ready);
    await seedReal(c);
    await copyTemplate(c, "sdlc", [PA_FIX.gPO, PA_FIX.gTech, PA_FIX.gTech]);
    c.script.set(0, [{ kind: "ask", question: "CSV dùng dấu phân cách nào?", choices: [] }]);

    const start = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: crypto.randomUUID(),
      content: "!sdlc Thêm xuất CSV",
    });
    expect(start.status).toBe(201);
    runId = start.headers.get("x-process-run-id") ?? "";
    flowId = start.headers.get("x-flow-id") ?? "";
    expect(runId).not.toBe("");

    // Intake hỏi lại ⇒ A nhờ H ⇒ H trả lời
    const ask = await waitTask(c, runId, "ask");
    expect(ask).not.toBeNull();
    const fw = await c.call("A", "POST", `/review-tasks/${ask?.id}/forward`, {
      to_user_id: PA.H.id,
      note: "Nhờ chị trả lời",
    });
    expect(fw.status).toBe(200);
    const ans = await c.call("H", "POST", `/review-tasks/${ask?.id}/answer`, {
      answer: "Dấu phẩy",
    });
    expect(ans.status).toBe(200);

    // cổng 1 (Intake, PO) — B
    const g1 = await waitTask(c, runId, "review");
    expect(g1).not.toBeNull();
    expect((await pass("B", g1?.id)).status).toBe(200);

    // cổng 2 (Sẵn sàng, Tech lead) — T ngoài phòng: thấy trong /me/review-tasks, Chưa đạt rồi Đạt
    const g2 = await until(
      async () => {
        const r = await c.call("T", "GET", "/me/review-tasks");
        return ((r.json?.items ?? []) as Json[]).find((i) => i.process_run?.id === runId) ?? null;
      },
      (v) => v !== null,
      30_000,
    );
    expect(g2?.task?.stage_name ?? g2?.task?.stage?.name).toBe("Sẵn sàng");
    const fail = await c.call("T", "POST", `/review-tasks/${g2?.task?.id}/decision`, {
      result: "fail",
      feedback: "Thiếu ma trận luật",
    });
    expect(fail.status).toBe(200);
    const g2b = await until(
      async () =>
        (
          await c.sql<
            Json[]
          >`select t.id from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id
        where t.process_run_id = ${runId} and t.kind = 'review' and t.status = 'open' and s.stage_idx = 4 and s.attempt = 2`
        )[0] ?? null,
      (v) => v !== null,
      20_000,
    );
    expect(g2b).not.toBeNull();
    expect((await pass("T", g2b?.id)).status).toBe(200);

    // cổng 3 (Review, Tech lead) — B
    const g3 = await until(
      async () =>
        (
          await c.sql<
            Json[]
          >`select t.id from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id
        where t.process_run_id = ${runId} and t.kind = 'review' and t.status = 'open' and s.stage_idx = 7`
        )[0] ?? null,
      (v) => v !== null,
      30_000,
    );
    expect(g3).not.toBeNull();
    expect((await pass("B", g3?.id)).status).toBe(200);
    const done = await until(
      () => runRow(c, runId),
      (r) => r?.status === "done",
      20_000,
    );
    expect(done?.status).toBe("done");
  }, 180_000);

  it("HUB-FR-106 · HUB-BR-24 · SC-1 · 8 stage done; stage 5 attempt 2, còn lại 1; 3 review pass + 1 fail; 1 ask, 1 forward; 13 job đều user_id = A", async () => {
    needSchema(c.ready);
    expect(runId).not.toBe("");
    const st = await c.sql<
      Json[]
    >`select stage_idx, status, attempt from hub.stage_runs where process_run_id = ${runId}
      order by stage_idx`;
    expect(st.map((s) => s.status)).toEqual(Array(8).fill("done"));
    expect(st.map((s) => s.attempt)).toEqual([1, 1, 1, 1, 2, 1, 1, 1]);
    const tasks = await c.sql<
      Json[]
    >`select kind, result from hub.review_tasks where process_run_id = ${runId}`;
    const reviews = tasks
      .filter((t) => t.kind === "review")
      .map((t) => t.result)
      .sort();
    expect(reviews).toEqual(["fail", "pass", "pass", "pass"]);
    expect(tasks.filter((t) => t.kind === "ask")).toHaveLength(1);
    const fwd = await c.sql<
      Json[]
    >`select a.user_id from hub.review_task_assignees a join hub.review_tasks t on t.id = a.task_id
      where t.process_run_id = ${runId} and a.via = 'forward'`;
    expect(fwd.map((f) => f.user_id)).toEqual([PA.H.id]);
    const jobs = c.handled.filter((h) => h.processRunId === runId);
    expect(jobs).toHaveLength(13);
    expect(new Set(jobs.map((j) => j.userId))).toEqual(new Set([PA.A.id]));
  });

  it("HUB-BR-25 · SC-1 · T, H không đọc được tin phòng R (404); notice run_finished cho A; usage totals = Σ usage_logs", async () => {
    needSchema(c.ready);
    for (const r of ["T", "H"] as const)
      expect((await c.call(r, "GET", `/rooms/${PA_FIX.room}/messages`)).status).toBe(404);
    const [n] = await c.sql<Json[]>`select count(*)::int as n from hub.process_notices
      where process_run_id = ${runId} and user_id = ${PA.A.id} and kind = 'run_finished'`;
    expect(n?.n).toBe(1);
    const [s] = await c.sql<
      Json[]
    >`select coalesce(sum(ul.input_tokens + ul.output_tokens), 0)::int as s
      from hub.usage_logs ul join hub.runs r on r.id = ul.run_id where r.process_run_id = ${runId}`;
    const u = await c.call("A", "GET", `/process-runs/${runId}/usage`);
    expect(u.status).toBe(200);
    const t = u.json?.totals ?? {};
    expect((t.input_tokens ?? 0) + (t.output_tokens ?? 0)).toBe(s?.s);
  });

  it("HUB-FR-113 · U1 · SC-1 · thread F có 18 tin process (1 block · 9 output · 1 ask · 1 forward · 5 task_result · 1 run_end); task_result của T/H outside:true", async () => {
    needSchema(c.ready);
    const msgs = await until(
      () => c.sql<Json[]>`select process_kind, process_meta from hub.room_messages
        where process_run_id = ${runId} and sender_type = 'process' order by seq`,
      (v) => v.length >= 18,
      10_000,
    );
    const count = (k: string) => msgs.filter((m) => m.process_kind === k).length;
    expect({
      total: msgs.length,
      block: count("block"),
      output: count("output"),
      ask: count("ask"),
      forward: count("forward"),
      task_result: count("task_result"),
      run_end: count("run_end"),
    }).toEqual({ total: 18, block: 1, output: 9, ask: 1, forward: 1, task_result: 5, run_end: 1 });
    const outside = msgs
      .filter((m) => m.process_kind === "task_result" && m.process_meta?.outside === true)
      .map((m) => m.process_meta.actor.id)
      .sort();
    expect(outside).toEqual([PA.H.id, PA.T.id, PA.T.id].sort());
    const [f] = await c.sql<
      Json[]
    >`select count(*)::int as n from hub.room_messages where flow_id = ${flowId}`;
    expect(f?.n).toBeGreaterThanOrEqual(18);
  });
});
