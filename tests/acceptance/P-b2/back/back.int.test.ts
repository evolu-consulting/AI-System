// HUB-FR-118 · HUB-BR-38(d) · HUB-FR-113 · AC-PB2-06 · test-plan-cases §3.4 `back/back` (BK-01…BK-09): người duyệt chọn
// "Quay lại bước X" khi Chưa đạt (`POST /review-tasks/:id/decision {result:"fail", feedback, back_to_step}`) ⇒ D7: bước X
// `queued` (round+1, góp ý), bước > X `pending`; event `process_back_events`; output cũ giữ; huỷ job/task cùng bước.
// DB tag `pb2_back`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  backEvents,
  backToB3,
  type CtxPb2,
  finishStages,
  hubRunsOf,
  type Json,
  jobDone,
  jobOfStage,
  MD_HO,
  needPb2,
  P1,
  PA,
  parToStep1,
  passStage,
  promptOf,
  review,
  runRow,
  stageRow,
  startPb2,
  T,
  taskOf,
  viewOf,
  waitFor,
  waitStage,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterAll(() => c?.stop());

const code = (r: { status: number; json: Json }) => ({
  status: r.status,
  code: r.json?.error?.code,
});

/** Một lần quay lại (BK-03) dùng chung cho BK-03…BK-06 (chạy tuần tự trong file). */
let once: Promise<{
  runId: string;
  taskId: string;
  job: Awaited<ReturnType<typeof jobOfStage>>;
}> | null = null;
function backOnce() {
  once ??= (async () => {
    const g = await backToB3(c);
    const r = await review(c, "B", g.taskId, {
      result: "fail",
      feedback: "Sai số tổng",
      back_to_step: 1,
    });
    expect(r.status).toBe(200);
    const job = await jobOfStage(c, g.runId, 1);
    return { runId: g.runId, taskId: g.taskId, job };
  })();
  return once;
}

describe("BK · kiểm đầu vào quay lại [HUB-FR-118]", () => {
  it("HUB-FR-118 · BK-01 · fail + back_to_step 1 không góp ý ⇒ 422 FEEDBACK_REQUIRED; task vẫn open", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c);
    expect(code(await review(c, "B", g.taskId, { result: "fail", back_to_step: 1 }))).toEqual({
      status: 422,
      code: "FEEDBACK_REQUIRED",
    });
    expect((await taskOf(c.sql, g.runId, 3))?.id).toBe(g.taskId);
    await c.call("A", "POST", `/process-runs/${g.runId}/cancel`, {});
  }, 60_000);
  it("HUB-FR-118 · BK-02 · pass + back_to_step ⇒ 422 BACK_TARGET_INVALID; fail + back_to_step 2 (∉ [1]) ⇒ 422 BACK_TARGET_INVALID", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c);
    expect(code(await review(c, "B", g.taskId, { result: "pass", back_to_step: 1 }))).toEqual({
      status: 422,
      code: "BACK_TARGET_INVALID",
    });
    expect(
      code(await review(c, "B", g.taskId, { result: "fail", feedback: "Sai", back_to_step: 2 })),
    ).toEqual({ status: 422, code: "BACK_TARGET_INVALID" });
    expect((await taskOf(c.sql, g.runId, 3))?.id).toBe(g.taskId);
    await c.call("A", "POST", `/process-runs/${g.runId}/cancel`, {});
  }, 60_000);
});

describe("BK · thực hiện quay lại (D7) [AC-PB2-06]", () => {
  it("AC-PB2-06 · BK-03 · quay lại bước 1 'Sai số tổng' ⇒ B1 chạy lại (1 job mới), B2/B3 pending; round 2 ở B1–B3; B0 giữ; run current_step 1, back_rounds 1, running", async () => {
    needPb2(c.pb2);
    const { runId } = await backOnce();
    expect((await hubRunsOf(c.sql, runId, 1)).length).toBe(2);
    const st = async (i: number) => {
      const r = await stageRow(c.sql, runId, i);
      return {
        i,
        status: r.status,
        round: r.round,
        attempt: r.attempt,
        out: r.current_output_id,
        by: r.passed_by,
      };
    };
    const b0 = await stageRow(c.sql, runId, 0);
    expect({ status: b0.status, round: b0.round }).toEqual({ status: "done", round: 1 });
    const b1 = await st(1);
    expect(["queued", "running"]).toContain(b1.status);
    expect({ round: b1.round, attempt: b1.attempt, out: b1.out, by: b1.by }).toEqual({
      round: 2,
      attempt: 1,
      out: null,
      by: null,
    });
    expect(await st(2)).toEqual({
      i: 2,
      status: "pending",
      round: 2,
      attempt: 1,
      out: null,
      by: null,
    });
    expect(await st(3)).toEqual({
      i: 3,
      status: "pending",
      round: 2,
      attempt: 1,
      out: null,
      by: null,
    });
    const r = await runRow(c.sql, runId);
    expect({
      step: r.current_step,
      idx: r.current_stage_idx,
      rounds: r.back_rounds,
      status: r.status,
    }).toEqual({ step: 1, idx: 1, rounds: 1, status: "running" });
  }, 60_000);
  it("HUB-FR-113 · BK-04 · đúng 1 process_back_events {3,3→1, round_after 2, góp ý, B, task}; task_result to_step 1; HistoryItem.to_step 1", async () => {
    needPb2(c.pb2);
    const { runId, taskId } = await backOnce();
    const evs = await backEvents(c.sql, runId);
    expect(
      evs.map((e) => ({
        from_stage_idx: e.from_stage_idx,
        from_step: e.from_step,
        to_step: e.to_step,
        round_after: e.round_after,
        feedback: e.feedback,
        decided_by: e.decided_by,
        task_id: e.task_id,
        tenant_id: e.tenant_id,
      })),
    ).toEqual([
      {
        from_stage_idx: 3,
        from_step: 3,
        to_step: 1,
        round_after: 2,
        feedback: "Sai số tổng",
        decided_by: PA.B.id,
        task_id: taskId,
        tenant_id: T.acme,
      },
    ]);
    const parts = await c.sql<Json[]>`select meta from hub.process_thread_events
      where process_run_id = ${runId} and kind = 'task_result'`;
    expect(parts.some((p) => p.meta?.result === "fail" && p.meta?.to_step === 1)).toBe(true);
    const v = await viewOf(c, "A", runId);
    const h = ((v.json?.history ?? []) as Json[]).find((x) => x.task_id === taskId);
    expect(h?.to_step).toBe(1);
  }, 60_000);
  it("AC-PB2-06 · BK-05 · prompt job B1 lần chạy lại chứa góp ý 'Sai số tổng'", async () => {
    needPb2(c.pb2);
    const { job } = await backOnce();
    expect(promptOf(job)).toContain("Sai số tổng");
  }, 60_000);
  it("HUB-FR-113 · BK-06 · output cũ giữ (round 1); B1 xong lần 2 ⇒ v2 round 2; StageView.outputs [v1, v2] round 1, 2", async () => {
    needPb2(c.pb2);
    const { runId, job } = await backOnce();
    await jobDone(c, job, MD_HO);
    await waitStage(c.sql, runId, 1, "waiting_review");
    const outs = await c.sql<Json[]>`select stage_idx, version, round from hub.process_outputs
      where process_run_id = ${runId} order by stage_idx, version`;
    expect(outs.filter((o) => o.stage_idx === 1)).toEqual([
      { stage_idx: 1, version: 1, round: 1 },
      { stage_idx: 1, version: 2, round: 2 },
    ]);
    expect(outs.filter((o) => o.stage_idx === 3).map((o) => o.round)).toEqual([1]);
    const v = await viewOf(c, "A", runId);
    const s1 = ((v.json?.stages ?? []) as Json[]).find((x) => x.idx === 1);
    expect((s1?.outputs ?? []).map((o: Json) => [o.version, o.round])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  }, 60_000);
  it("AC-PB2-06 · BK-07 · pb2-par Tổng hợp quay lại bước 1 ⇒ stage 1, 2 cùng chạy lại (2 job, prompt có góp ý); stage 3 pending", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    await passStage(c, runId, 1, "B");
    await passStage(c, runId, 2, "T");
    await finishStages(c, runId, [3]);
    await waitStage(c.sql, runId, 3, "waiting_review");
    const t3 = await taskOf(c.sql, runId, 3);
    const r = await review(c, "B", t3?.id, {
      result: "fail",
      feedback: "Thiếu số liệu",
      back_to_step: 1,
    });
    expect(r.status).toBe(200);
    const j1 = await jobOfStage(c, runId, 1);
    const j2 = await jobOfStage(c, runId, 2);
    expect([
      promptOf(j1).includes("Thiếu số liệu"),
      promptOf(j2).includes("Thiếu số liệu"),
    ]).toEqual([true, true]);
    expect((await stageRow(c.sql, runId, 3)).status).toBe("pending");
  }, 60_000);
  it("HUB-FR-118 · BK-08 · quay về bước 0 khi Rà soát code đang chạy ⇒ hub.runs cancelled; output muộn bị bỏ; task mở khác superseded", async () => {
    needPb2(c.pb2);
    const a = await parToStep1(c);
    const j1 = await jobOfStage(c, a.runId, 1);
    await finishStages(c, a.runId, [2]);
    await waitStage(c.sql, a.runId, 2, "waiting_review");
    const t2 = await taskOf(c.sql, a.runId, 2);
    const r = await review(c, "T", t2?.id, {
      result: "fail",
      feedback: "Làm lại phân tích",
      back_to_step: 0,
    });
    expect(r.status).toBe(200);
    const runs1 = await waitFor(
      () => hubRunsOf(c.sql, a.runId, 1),
      (rs) => rs.every((x) => x.status === "cancelled"),
      8_000,
    );
    expect((runs1 ?? []).map((x) => x.status)).toEqual(["cancelled"]);
    await jobDone(c, j1, MD_HO);
    await jobOfStage(c, a.runId, 0);
    const late = await c.sql<
      Json[]
    >`select id from hub.process_outputs where process_run_id = ${a.runId} and stage_idx = 1`;
    expect(late).toHaveLength(0);
    const s1 = await stageRow(c.sql, a.runId, 1);
    expect({ status: s1.status, run: s1.current_run_id }).toEqual({ status: "pending", run: null });
    // task review mở của stage cùng bước bị quay lại ⇒ superseded
    const b = await parToStep1(c, { both: true });
    const tb1 = await taskOf(c.sql, b.runId, 1);
    const tb2 = await taskOf(c.sql, b.runId, 2);
    expect(
      (await review(c, "T", tb2?.id, { result: "fail", feedback: "Về đầu", back_to_step: 0 }))
        .status,
    ).toBe(200);
    const [x] = await c.sql<
      Json[]
    >`select status, result from hub.review_tasks where id = ${tb1?.id}`;
    expect(x).toEqual({ status: "closed", result: "superseded" });
  }, 90_000);
  it("HUB-FR-114 · BK-09 · team_runs đang chạy ở stage bị reset ⇒ cancelled", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    await passStage(c, runId, 1, "B");
    await passStage(c, runId, 2, "T");
    await finishStages(c, runId, [3]);
    await waitStage(c.sql, runId, 3, "waiting_review");
    const s1 = await stageRow(c.sql, runId, 1);
    const [tr] = await c.sql<
      Json[]
    >`insert into hub.team_runs (tenant_id, stage_run_id, process_run_id, attempt, team_id,
        mode, status) values (${T.acme}, ${s1.id}, ${runId}, 1, ${P1.teamPm}, 'parallel_merge', 'running') returning id`;
    const t3 = await taskOf(c.sql, runId, 3);
    expect(
      (await review(c, "B", t3?.id, { result: "fail", feedback: "Lại", back_to_step: 1 })).status,
    ).toBe(200);
    const [after] = await c.sql<Json[]>`select status from hub.team_runs where id = ${tr?.id}`;
    expect(after?.status).toBe("cancelled");
  }, 60_000);
});
