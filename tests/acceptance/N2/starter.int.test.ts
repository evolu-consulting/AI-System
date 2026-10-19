// N2-FR-05 · N2-AC12/AC13 · cờ stage `after.exclude_starter`: người bắt đầu run (kể cả thuộc Group duyệt) không quyết được
// task duyệt của stage (403 STARTER_CANNOT_REVIEW, `can_act=false`); thành viên khác quyết được. Cờ tắt ⇒ hành vi cũ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  createDef,
  decide,
  decisionOf,
  defBody,
  G1,
  type Json,
  jobDone,
  mdOut,
  nextStageJob,
  PA,
  review,
  runRow,
  stageHubRuns,
  stageOf,
  startRun,
  T,
  waitStageStatus,
} from "../P-d/_support/pd";
import { type CtxN2, errCode, startN2 } from "./_n2";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2({ processRunsPerTenant: 200 });
  // A (người bắt đầu, có grant agent hd-read) vào G1 Kế toán (B, T) ⇒ starter cũng là người duyệt.
  await c.sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.acme}, ${G1}, ${PA.A.id})`;
  await c.sql`select pg_notify('config_changed', json_build_object('v', 0, 'entity', 'group',
    'tenant_id', ${T.acme}::text)::text)`;
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

let seq = 0;
/** Def 1 stage review G1 (A, B, T); A bắt đầu run ⇒ tới waiting_review; trả {runId, taskId}. */
async function toReview(exclude: boolean | undefined): Promise<{ runId: string; taskId: string }> {
  const key = `n2-st-${++seq}`;
  const after: Json = { kind: "review", group_id: G1, back_to_steps: [] };
  if (exclude !== undefined) after.exclude_starter = exclude;
  await createDef(c, defBody(key, [agentStage({ key: "s0", step: 0, after })]));
  const runId = await startRun(c, key);
  await jobDone(c, await nextStageJob(c, runId), mdOut());
  await waitStageStatus(c, runId, 0, "waiting_review");
  const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
    and kind = 'review' and status = 'open'`;
  return { runId, taskId: t?.id as string };
}

describe("N2-AC12/13 · người bắt đầu không duyệt stage [N2-FR-05]", () => {
  it("N2-FR-05 · contract: exclude_starter lưu + đọc lại (def GET)", async () => {
    const key = `n2-st-${++seq}`;
    const after = { kind: "review", group_id: G1, back_to_steps: [], exclude_starter: true };
    const d = await createDef(c, defBody(key, [agentStage({ key: "s0", step: 0, after })]));
    expect(d.stages[0].after.exclude_starter).toBe(true);
  });

  it("N2-AC12 · cờ bật: A (người bắt đầu ∈ G1) Đạt / Từ chối ⇒ 403 STARTER_CANNOT_REVIEW, can_act=false; T Đạt ⇒ 200", async () => {
    const { runId, taskId } = await toReview(true);
    const bodies = [
      { result: "pass" },
      { result: "fail", feedback: "x" },
      { result: "reject", feedback: "x" },
    ];
    for (const body of bodies) {
      const r = await review(c, "A", taskId, body);
      expect({ status: r.status, code: errCode(r) }).toEqual({
        status: 403,
        code: "STARTER_CANNOT_REVIEW",
      });
    }
    const v = await c.call("A", "GET", `/process-runs/${runId}`);
    const mine = ((v.json?.my_tasks ?? []) as Json[]).find((t) => t.id === taskId);
    expect({ seen: mine !== undefined, can_act: mine?.can_act }).toEqual({
      seen: true,
      can_act: false,
    });
    const ok = await review(c, "T", taskId, { result: "pass" });
    expect({ status: ok.status, code: errCode(ok) }).toEqual({ status: 200, code: null });
    expect((await runRow(c.sql, runId))?.status).toBe("done");
  }, 60_000);

  it("N2-AC13 · cờ tắt / vắng (def cũ): A người bắt đầu ∈ G1 Đạt ⇒ 200", async () => {
    for (const ex of [false, undefined]) {
      const { taskId } = await toReview(ex);
      const r = await review(c, "A", taskId, { result: "pass" });
      expect({ ex, status: r.status }).toEqual({ ex, status: 200 });
    }
  }, 60_000);
});

describe("N2-D06 · security M1 · người bắt đầu không quyết decision redo_limit của stage exclude_starter", () => {
  it("N2-D06 · 4 lần Chưa đạt ⇒ redo_limit; A (người bắt đầu ∈ G1) use_current ⇒ 403 STARTER_CANNOT_REVIEW, stage real_action không chạy; T use_current ⇒ 200, stage real_action có job", async () => {
    const key = `n2-st-${++seq}`;
    const after: Json = { kind: "review", group_id: G1, back_to_steps: [], exclude_starter: true };
    await createDef(
      c,
      defBody(key, [
        agentStage({ key: "s0", step: 0, after }),
        agentStage({ key: "s1", step: 1, real_action: true }),
      ]),
    );
    const runId = await startRun(c, key);
    for (let i = 0; i < 4; i++) {
      await jobDone(c, await nextStageJob(c, runId), mdOut());
      await waitStageStatus(c, runId, 0, "waiting_review");
      const [t] = await c.sql<
        Json[]
      >`select id from hub.review_tasks where process_run_id = ${runId}
        and kind = 'review' and status = 'open'`;
      expect(
        (await review(c, "T", t?.id, { result: "fail", feedback: `lần ${i + 1}` })).status,
      ).toBe(200);
    }
    expect((await decisionOf(c.sql, runId))?.reason).toBe("redo_limit");
    const no = await decide(c, "A", runId, "use_current");
    expect({ status: no.status, code: errCode(no) }).toEqual({
      status: 403,
      code: "STARTER_CANNOT_REVIEW",
    });
    expect(await stageHubRuns(c.sql, runId)).toHaveLength(4); // chỉ 4 job của s0, s1 chưa chạy
    expect((await stageOf(c.sql, runId, 1))?.status).toBe("pending");
    const ok = await decide(c, "T", runId, "use_current");
    expect({ status: ok.status, code: errCode(ok) }).toEqual({ status: 200, code: null });
    const job = await nextStageJob(c, runId);
    expect((await stageOf(c.sql, runId, 1))?.current_run_id).toBe(job.runId);
  }, 90_000);
});
