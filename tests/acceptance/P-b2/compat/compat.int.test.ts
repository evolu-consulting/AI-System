// HUB-FR-104 · HUB-FR-106 · AC-PB2-01 · PB2-R14 · test-plan-cases §3.6 `compat` (CP-01…CP-05): def/run cũ (không `step`)
// chạy y như P-a — tuần tự, `current_step = current_stage_idx`, view `step = idx`, `round = 1`, `back_to_steps = []`; real_action
// theo luật cũ; meta thread cũ (OutputRef không `round`) đọc lại không 500. DB tag `pb2_compat`. 0024 vắng ⇒ `needPb2`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { part } from "../../P-a/_support/parts";
import {
  insertEvent,
  insertOutput,
  insertRun,
  insertTask,
} from "../../P-a/_support/process-fixtures";
import { MD_OK, postThread } from "../../P-a/pf1/_local";
import { loadChat } from "../_support/_modules";
import {
  type CtxPb2,
  type Json,
  jobDone,
  jobOfStage,
  needPb2,
  P1,
  PA,
  PA_FIX,
  passStage,
  review,
  runRow,
  settleRuns,
  st,
  startInRoom,
  startPb2,
  T,
  viewOf,
  waitStatus,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterEach(async () => {
  if (c?.pb2) await settleRuns(c.sql);
});
afterAll(() => c?.stop());

const sameIdx = async (runId: string) => {
  const r = await runRow(c.sql, runId);
  return { step: r.current_step, idx: r.current_stage_idx };
};
/** Run kiểu P-a (snapshot không `step`), 2 stage review, đứng `waiting_review` ở stage 1 — mô phỏng run có trước 0024. */
async function legacyAtStage1(): Promise<{ runId: string; taskId: string }> {
  const KT = PA_FIX.gKeToan;
  const stages = [
    st({ key: "doc", name: "Đọc hoá đơn", agent: P1.agRead, review: KT }),
    st({ key: "duyet", name: "Duyệt", agent: P1.agRead, review: KT }),
  ];
  const r = await insertRun(c.sql, {
    def: { id: PA_FIX.defHoaDon, key: "hoa-don-t", name: "Hoá đơn thử", stages },
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "waiting_review",
    stageIdx: 1,
  });
  // backfill 0024 cho run có sẵn: current_step = current_stage_idx
  await c.sql`update hub.process_runs set current_step = current_stage_idx where id = ${r.runId}`;
  for (const i of [0, 1])
    await insertOutput(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[i] as string,
      stageIdx: i,
      content: MD_OK,
    });
  const out = (
    await c.sql<
      Json[]
    >`select current_output_id from hub.stage_runs where id = ${r.stageRunIds[1] as string}`
  )[0];
  const taskId = await insertTask(c.sql, {
    tid: T.acme,
    runId: r.runId,
    stageRunId: r.stageRunIds[1] as string,
    kind: "review",
    outputId: out?.current_output_id,
    groupId: KT,
  });
  return { runId: r.runId, taskId };
}

describe("CP · tương thích ngược [AC-PB2-01][PB2-R14]", () => {
  it("AC-PB2-01 · CP-01 · hoa-don-t (không step) chạy hết như P-a: tuần tự, current_step = current_stage_idx mọi lúc", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c);
    const j0 = await jobOfStage(c, s.runId, 0);
    expect(await sameIdx(s.runId)).toEqual({ step: 0, idx: 0 });
    await jobDone(c, j0, MD_OK);
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect(await sameIdx(s.runId)).toEqual({ step: 0, idx: 0 });
    await passStage(c, s.runId, 0, "B");
    const j1 = await jobOfStage(c, s.runId, 1);
    expect(await sameIdx(s.runId)).toEqual({ step: 1, idx: 1 });
    await jobDone(c, j1, "## Kết quả\nĐã ghi sổ.");
    await waitStatus(c.sql, s.runId, "done");
    expect(await sameIdx(s.runId)).toEqual({ step: 1, idx: 1 });
  }, 60_000);
  it("AC-PB2-01 · CP-02 · run chèn SQL kiểu P-a đang waiting_review stage 1 ⇒ view step = idx, round 1, back_to_steps []; Đạt ⇒ done", async () => {
    needPb2(c.pb2);
    const g = await legacyAtStage1();
    const v = (await viewOf(c, "A", g.runId)).json;
    expect(
      ((v?.stages ?? []) as Json[]).map((x) => [x.idx, x.step, x.round, x.back_to_steps]),
    ).toEqual([
      [0, 0, 1, []],
      [1, 1, 1, []],
    ]);
    expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
    await waitStatus(c.sql, g.runId, "done");
  }, 60_000);
  it("AC-PB2-01 · CP-03 · GET run cũ ⇒ parse schema mới ok; step_count = số stage", async () => {
    needPb2(c.pb2);
    const g = await legacyAtStage1();
    const v = (await viewOf(c, "A", g.runId)).json;
    expect({ count: v?.step_count, step: v?.current_step }).toEqual({ count: 2, step: 1 });
    const ch = await loadChat();
    expect(ch.ProcessRunViewSchema?.safeParse?.(v)?.success).toBe(true);
  }, 60_000);
  it("AC-PB2-05 · CP-04 · real_action def cũ: stage trước review ⇒ chạy; audit authorize_real_action actor = người Đạt", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c);
    await jobDone(c, await jobOfStage(c, s.runId, 0), MD_OK);
    await passStage(c, s.runId, 0, "B");
    await jobOfStage(c, s.runId, 1);
    const audit = await c.sql<Json[]>`select actor_id from hub.audit_log
      where action = 'authorize_real_action' and entity_id = ${s.runId}`;
    expect(audit.map((a) => a.actor_id)).toEqual([PA.B.id]);
  }, 60_000);
  it("HUB-FR-113 · CP-05 · tin thread meta cũ (OutputRef không round/handoff_truncated) đọc lại ⇒ 200, không 500", async () => {
    needPb2(c.pb2);
    const g = await legacyAtStage1();
    await insertEvent(c.sql, { runId: g.runId, roomId: PA_FIX.room, meta: part.block(g.runId) });
    await insertEvent(c.sql, { runId: g.runId, roomId: PA_FIX.room, meta: part.output(g.runId) });
    await postThread(c);
    const r = await c.call("A", "GET", `/rooms/${PA_FIX.room}/messages?limit=50`);
    expect(r.status).toBe(200);
    const flowItems = await c.call("A", "GET", `/process-runs/${g.runId}`);
    expect(flowItems.status).toBe(200);
  }, 60_000);
});
