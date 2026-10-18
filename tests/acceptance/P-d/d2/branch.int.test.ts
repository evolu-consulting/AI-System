// AC-H45 · HUB-FR-147 · HUB-BR-38(e) · test-plan-d2 §3.3 PD2-I30…I37 (I35–I37: T15b) (plan-d2 §7, D2-08, Q-D2-3): rẽ nhánh qua Hub thật. Def 5 bước
// (0…4): s1 bước 1 (agent, fields tong_tien, review G1, branch gt 20000000 ⇒ goto 3). Đi tắt: stage bước bị nhảy `skipped`,
// quay lại xuyên qua `skipped` ⇒ `pending`, `round` không tăng. Thiếu 0037/contract ⇒ đỏ NGAY ở `needD2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decisionOf,
  defBody,
  FIELD_NGAY,
  G1,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  noStageJob,
  openTimers,
  runRow,
  stageOf,
  startRun,
  waitStage,
  waitStageStatus,
  waitStatus,
} from "../_support/pd";
import { auditsOf, type CtxD2, needD2, settled, startD2 } from "./_d2";

let c: CtxD2;
beforeAll(async () => {
  c = await startD2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const RULE = { field: "tong_tien", op: "gt", value: 20_000_000, goto_step: 3 };
const FIELDS = [{ key: "tong_tien", type: "number", required: true }];
let seq = 0;
async function branchDef(o: { s3RealAction?: boolean } = {}): Promise<string> {
  const key = `pd2-br-${++seq}`;
  await createDef(
    c,
    defBody(key, [
      agentStage({ key: "s0", step: 0 }),
      agentStage({
        key: "s1",
        step: 1,
        fields: FIELDS,
        after: { kind: "review", group_id: G1, back_to_steps: [0], branch: [RULE] },
      }),
      agentStage({ key: "s2", step: 2 }),
      agentStage({
        key: "s3",
        step: 3,
        after: { kind: "review", group_id: G1, back_to_steps: [1] },
        real_action: o.s3RealAction ?? false,
      }),
      agentStage({ key: "s4", step: 4 }),
    ]),
  );
  return key;
}
/** Tới review s1 với `tong_tien`; trả {runId, taskId}. */
async function toReview(key: string, tong: number): Promise<{ runId: string; taskId: string }> {
  const runId = await startRun(c, key);
  await jobDone(c, await nextStageJob(c, runId));
  await jobDone(c, await nextStageJob(c, runId), mdOut({ tong_tien: tong }));
  await waitStageStatus(c.sql, runId, 1, "waiting_review");
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open' order by created_at desc limit 1`;
  return { runId, taskId: t?.id as string };
}
const pass = async (taskId: string) => {
  const res = await c.call("B", "POST", `/review-tasks/${taskId}/decision`, { result: "pass" });
  expect(res.status).toBe(200);
  await settled(c);
};

describe("AC-H45 · rẽ nhánh khi khớp / không khớp", () => {
  it("AC-H45 · PD2-I30 · 25000000 + Đạt ⇒ s2 skipped (finished_at), current_step 3, s3 có job, thread 'Rẽ nhánh: tới bước 4 (luật 1)', audit branch {1→3, luật 1}", async () => {
    await needD2(c);
    const { runId, taskId } = await toReview(await branchDef(), 25_000_000);
    await pass(taskId);
    const s2 = await stageOf(c.sql, runId, 2);
    expect({ status: s2?.status, finished: s2?.finished_at != null }).toEqual({
      status: "skipped",
      finished: true,
    });
    expect((await runRow(c.sql, runId))?.current_step).toBe(3);
    const job = await nextStageJob(c, runId);
    expect((await stageOf(c.sql, runId, 3))?.current_run_id).toBe(job.runId);
    const [ev] = await c.sql<
      Json[]
    >`select * from hub.process_thread_events where process_run_id = ${runId}
      and kind = 'branch'`;
    expect(ev).toBeDefined();
    const [msg] = await c.sql<
      Json[]
    >`select content from hub.room_messages where process_kind = 'branch'
      and content like ${"Rẽ nhánh: tới bước 4 (luật 1)%"}`;
    expect(msg?.content).toBe("Rẽ nhánh: tới bước 4 (luật 1)");
    const au = await auditsOf(c.sql, "branch", runId);
    expect(au).toHaveLength(1);
    expect(au[0]?.actor_id ?? null).toBeNull();
    expect(au[0]?.details).toMatchObject({ from_step: 1, to_step: 3, rule: 1 });
    expect((await openTimers(c.sql, runId)).length).toBe(0); // PD2-I33
  }, 30_000);
  it("AC-H45 · PD2-I31 · 1000 + Đạt ⇒ s2 chạy tuần tự, 0 audit branch", async () => {
    await needD2(c);
    const { runId, taskId } = await toReview(await branchDef(), 1000);
    await pass(taskId);
    await nextStageJob(c, runId);
    expect((await stageOf(c.sql, runId, 2))?.status).toBe("running");
    expect(await auditsOf(c.sql, "branch", runId)).toHaveLength(0);
  }, 30_000);
});

describe("AC-H45 · stage skipped = xong; bước trước có hiệu lực (T15b)", () => {
  it("AC-H45 · PD2-I35 · nhảy s2 (skipped), s3 Đạt, s4 xong ⇒ run done", async () => {
    await needD2(c);
    const { runId, taskId } = await toReview(await branchDef(), 25_000_000);
    await pass(taskId);
    await jobDone(c, await nextStageJob(c, runId));
    await waitStageStatus(c.sql, runId, 3, "waiting_review");
    const [t3] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open' order by created_at desc limit 1`;
    await pass(t3?.id as string);
    await jobDone(c, await nextStageJob(c, runId));
    await waitStatus(c.sql, runId, "done");
    expect((await stageOf(c.sql, runId, 2))?.status).toBe("skipped");
  }, 30_000);
  it("AC-H45 · PD2-I36 · D2-08 · đích s3 real_action, s1 review Đạt, s2 skipped ⇒ s3 chạy được (bước trước có hiệu lực = s1)", async () => {
    await needD2(c);
    const { runId, taskId } = await toReview(await branchDef({ s3RealAction: true }), 25_000_000);
    await pass(taskId);
    expect((await stageOf(c.sql, runId, 2))?.status).toBe("skipped");
    const job = await nextStageJob(c, runId);
    expect((await stageOf(c.sql, runId, 3))?.current_run_id).toBe(job.runId);
    expect(await decisionOf(c.sql, runId)).toBeUndefined();
  }, 30_000);
  it("AC-H45 · PD2-I37 · AC-H41 · wait_until s3 lấy field của s2 bị skipped ⇒ needs_decision timer_invalid", async () => {
    await needD2(c);
    const key = `pd2-br-${++seq}`;
    await createDef(
      c,
      defBody(key, [
        agentStage({ key: "s0", step: 0 }),
        agentStage({
          key: "s1",
          step: 1,
          fields: FIELDS,
          after: { kind: "review", group_id: G1, back_to_steps: [0], branch: [RULE] },
        }),
        agentStage({ key: "s2", step: 2, fields: FIELD_NGAY }),
        waitStage({
          key: "s3",
          step: 3,
          from: { kind: "field", stage_key: "s2", field: "ngay_het_han" },
        }),
        agentStage({ key: "s4", step: 4 }),
      ]),
    );
    const { runId, taskId } = await toReview(key, 25_000_000);
    await pass(taskId);
    expect((await stageOf(c.sql, runId, 2))?.status).toBe("skipped");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("timer_invalid");
  }, 30_000);
});

describe("AC-H45 · quay lại xuyên qua stage skipped [PB2-R07, D2-08]", () => {
  it("AC-H45 · PD2-I32 · sau nhảy, s3 review trả về bước 1 ⇒ s2 skipped → pending, round s2 không tăng; lần sau 1000 ⇒ đi s2", async () => {
    await needD2(c);
    const key = await branchDef();
    const { runId, taskId } = await toReview(key, 25_000_000);
    await pass(taskId);
    const roundBefore = (await stageOf(c.sql, runId, 2))?.round;
    await jobDone(c, await nextStageJob(c, runId));
    await waitStageStatus(c.sql, runId, 3, "waiting_review");
    const [t3] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open' order by created_at desc limit 1`;
    const res = await c.call("B", "POST", `/review-tasks/${t3?.id}/decision`, {
      result: "fail",
      feedback: "Làm lại từ bước 2",
      back_to_step: 1,
    });
    expect(res.status).toBe(200);
    await settled(c);
    const s2 = await stageOf(c.sql, runId, 2);
    expect({ status: s2?.status, round: s2?.round }).toEqual({
      status: "pending",
      round: roundBefore,
    });
    expect(await noStageJob(c, runId)).toBe(false);
  }, 30_000);
  it("AC-H45 · PD2-I34 · lưu def goto_step = step / stage rẽ nhánh trong bước song song ⇒ 422 BRANCH_INVALID", async () => {
    await needD2(c);
    const bad = (stages: Json[]) =>
      c.call("Adm", "POST", "/process-defs", defBody(`pd2-bad-${++seq}`, stages));
    const s1 = (goto: number) =>
      agentStage({
        key: "s1",
        step: 1,
        fields: FIELDS,
        after: {
          kind: "review",
          group_id: G1,
          back_to_steps: [],
          branch: [{ ...RULE, goto_step: goto }],
        },
      });
    const base = [
      agentStage({ key: "s0", step: 0 }),
      agentStage({ key: "s3", step: 2 }),
      agentStage({ key: "s4", step: 3 }),
    ];
    for (const r of [
      await bad([...base, s1(1)]),
      await bad([...base, s1(3), agentStage({ key: "p", step: 1 })]),
    ]) {
      expect({ status: r.status, rules: r.json?.error?.details?.rules }).toEqual({
        status: 422,
        rules: expect.arrayContaining(["BRANCH_INVALID"]),
      });
    }
  }, 30_000);
});
