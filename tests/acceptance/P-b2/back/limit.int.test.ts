// HUB-FR-118(d) · AC-PB2-07 · G-3 · plan D8/D9 · test-plan-cases §3.4 `back/limit` (BL-01…BL-07): quá trần `back_limit`
// ⇒ stage nguồn `needs_decision back_limit` (lưu đích + góp ý, KHÔNG reset); người quyết như `redo_limit`; `add_attempt`
// ⇒ +1 vòng rồi quay lại; `use_current` ⇒ Đạt; `cancel` ⇒ huỷ; `TaskDetail.back_steps/back_rounds_left`; `decide stage_idx`.
// DB tag `pb2_back`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { noStageJob } from "../../P-a/pf1/_local";
import {
  backEvents,
  backToB3,
  type CtxPb2,
  DEFS2,
  finishStages,
  type Json,
  jobOfStage,
  needPb2,
  PA,
  PA_FIX,
  review,
  runRow,
  stageRow,
  startInRoom,
  startPb2,
  taskOf,
  viewOf,
  waitStage,
  waitStatus,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterAll(() => c?.stop());

/** pb2-back tới B3, đặt back_rounds=3 (SQL), B chọn quay lại bước 1 ⇒ needs_decision back_limit. */
async function atLimit(): Promise<{ runId: string; taskId: string; decisionId: string }> {
  const g = await backToB3(c);
  await c.sql`update hub.process_runs set back_rounds = 3 where id = ${g.runId}`;
  const r = await review(c, "B", g.taskId, {
    result: "fail",
    feedback: "Vượt trần",
    back_to_step: 1,
  });
  expect(r.status).toBe(200);
  await waitStatus(c.sql, g.runId, "needs_decision");
  const d = await taskOf(c.sql, g.runId, 3, "decision");
  return { runId: g.runId, taskId: g.taskId, decisionId: d?.id };
}
const decide = (runId: string, body: Json, who: "A" | "B" = "A") =>
  c.call(who, "POST", `/process-runs/${runId}/decide`, body);

describe("BL · trần quay lại [AC-PB2-07][HUB-FR-118]", () => {
  it("AC-PB2-07 · BL-01 · back_rounds 3 + chọn quay lại ⇒ 200, KHÔNG reset: B3 needs_decision (back_to_step 1, feedback), decision back_limit; 0 event; 0 job", async () => {
    needPb2(c.pb2);
    const { runId, decisionId } = await atLimit();
    const s3 = await stageRow(c.sql, runId, 3);
    expect({ status: s3.status, to: s3.back_to_step, fb: s3.feedback }).toEqual({
      status: "needs_decision",
      to: 1,
      fb: "Vượt trần",
    });
    const [d] = await c.sql<Json[]>`select reason from hub.review_tasks where id = ${decisionId}`;
    expect(d?.reason).toBe("back_limit");
    expect((await viewOf(c, "A", runId)).json?.decision).toMatchObject({
      reason: "back_limit",
      back_to_step: 1,
    });
    expect(await backEvents(c.sql, runId)).toHaveLength(0);
    expect(await noStageJob(c, runId)).toBe(true);
    expect((await stageRow(c.sql, runId, 1)).round).toBe(1);
  }, 60_000);
  it("HUB-FR-118 · BL-02 · G-3 · người quyết như redo_limit: A + Group kiểm của stage, không tenant_admin", async () => {
    needPb2(c.pb2);
    const { decisionId } = await atLimit();
    const as = await c.sql<
      Json[]
    >`select user_id, group_id from hub.review_task_assignees where task_id = ${decisionId}`;
    const users = as.map((a) => a.user_id).filter(Boolean);
    const groups = as.map((a) => a.group_id).filter(Boolean);
    expect({ hasA: users.includes(PA.A.id), noAdm: !users.includes(PA.Adm.id), groups }).toEqual({
      hasA: true,
      noAdm: true,
      groups: [PA_FIX.gKeToan],
    });
  }, 60_000);
  it("AC-PB2-07 · BL-03 · A add_attempt ⇒ back_limit 4, back_rounds 4, quay lại thực hiện (B1 chạy, round+1); event decided_by A, task_id = task decision", async () => {
    needPb2(c.pb2);
    const { runId, decisionId } = await atLimit();
    expect((await decide(runId, { option: "add_attempt" })).status).toBe(200);
    await jobOfStage(c, runId, 1);
    const r = await runRow(c.sql, runId);
    expect({ limit: r.back_limit, rounds: r.back_rounds, step: r.current_step }).toEqual({
      limit: 4,
      rounds: 4,
      step: 1,
    });
    expect((await stageRow(c.sql, runId, 1)).round).toBe(2);
    const evs = await backEvents(c.sql, runId);
    expect(
      evs.map((e) => ({ by: e.decided_by, task: e.task_id, to: e.to_step, fb: e.feedback })),
    ).toEqual([{ by: PA.A.id, task: decisionId, to: 1, fb: "Vượt trần" }]);
  }, 60_000);
  it("AC-PB2-07 · BL-04 · use_current ⇒ B3 coi Đạt ⇒ run done (bước cuối)", async () => {
    needPb2(c.pb2);
    const { runId } = await atLimit();
    expect((await decide(runId, { option: "use_current" })).status).toBe(200);
    await waitStatus(c.sql, runId, "done");
    expect((await stageRow(c.sql, runId, 3)).status).toBe("done");
  }, 60_000);
  it("AC-PB2-07 · BL-05 · cancel ⇒ run cancelled", async () => {
    needPb2(c.pb2);
    const { runId } = await atLimit();
    expect((await decide(runId, { option: "cancel" })).status).toBe(200);
    await waitStatus(c.sql, runId, "cancelled");
  }, 60_000);
  it("HUB-FR-118 · BL-06 · TaskDetail review mở B3: back_steps [1], back_rounds_left = 3 − back_rounds; stage không back_to_steps ⇒ không có trường", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c);
    await c.sql`update hub.process_runs set back_rounds = 1 where id = ${g.runId}`;
    const v = await viewOf(c, "B", g.runId);
    const t = ((v.json?.my_tasks ?? []) as Json[]).find((x) => x.id === g.taskId);
    expect({ steps: t?.back_steps, left: t?.back_rounds_left }).toEqual({ steps: [1], left: 2 });
    const r1 = await c.sql<
      Json[]
    >`select t.id from hub.review_tasks t join hub.stage_runs sr on sr.id = t.stage_run_id
      where t.process_run_id = ${g.runId} and sr.stage_idx = 1 and t.kind = 'review'`;
    expect(r1.length).toBeGreaterThan(0);
    // B1 (không back_to_steps): task đã đóng — dựng thêm 1 run tới B1 waiting_review để xem TaskDetail mở
    const h = await backToB1(c);
    const v2 = await viewOf(c, "B", h.runId);
    const t1 = ((v2.json?.my_tasks ?? []) as Json[]).find((x) => x.stage_idx === 1);
    expect(t1).toBeDefined();
    expect({ steps: "back_steps" in (t1 ?? {}), left: "back_rounds_left" in (t1 ?? {}) }).toEqual({
      steps: false,
      left: false,
    });
  }, 60_000);
  it("HUB-FR-118 · BL-07 · decide {stage_idx: 2} khi stage 2 không có decision mở ⇒ 409 PROCESS_RUN_STATE", async () => {
    needPb2(c.pb2);
    const { runId } = await atLimit();
    const r = await decide(runId, { option: "cancel", stage_idx: 2 });
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 409,
      code: "PROCESS_RUN_STATE",
    });
    expect((await runRow(c.sql, runId)).status).toBe("needs_decision");
  }, 60_000);
});

/** pb2-back tới B1 `waiting_review`. */
async function backToB1(ctx: CtxPb2): Promise<{ runId: string }> {
  const s = await startInRoom(ctx, { key: DEFS2.back.key });
  await finishStages(ctx, s.runId, [0, 1]);
  await waitStage(ctx.sql, s.runId, 1, "waiting_review");
  return { runId: s.runId };
}
