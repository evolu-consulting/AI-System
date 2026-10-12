// HUB-FR-106 · HUB-BR-38 · plan §7 (đua) · test-plan-cases §3.3 `par/race` (RA-01…RA-03): mọi tx ghi khoá `process_runs`
// FOR UPDATE trước ⇒ job xong song song / Đạt ∥ output / decision ∥ back_limit được tuần tự hoá. Mỗi ca lặp 10 vòng (mẫu
// P1-47). DB tag `pb2_par`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPb2,
  DEFS2,
  finishStages,
  hubRunsOf,
  type Json,
  jobDone,
  jobOfStage,
  MD_HO,
  needPb2,
  parToStep1,
  passStage,
  review,
  runRow,
  settleRuns,
  stageRow,
  startInRoom,
  startPb2,
  taskOf,
  waitFor,
  waitStage,
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

const ROUNDS = 10;

describe("RA · đua trong bước song song [HUB-FR-106][plan §7]", () => {
  it("HUB-FR-106 · RA-01 · Y1, Y2, Y3 jobDone đồng thời ⇒ đúng MỘT next_step; Z đúng 1 hub.runs (10 vòng)", async () => {
    needPb2(c.pb2);
    for (let k = 0; k < ROUNDS; k++) {
      const s = await startInRoom(c, { key: DEFS2.auto3.key, input: `RA-01 vòng ${k}` });
      await finishStages(c, s.runId, [0]);
      const ys = [
        await jobOfStage(c, s.runId, 1),
        await jobOfStage(c, s.runId, 2),
        await jobOfStage(c, s.runId, 3),
      ];
      await Promise.all(ys.map((j) => jobDone(c, j, MD_HO)));
      await jobOfStage(c, s.runId, 4);
      const z = await waitFor(
        () => hubRunsOf(c.sql, s.runId, 4),
        (rs) => rs.length > 1,
        1_000,
      );
      expect({ k, z: (z ?? []).length, step: (await runRow(c.sql, s.runId)).current_step }).toEqual(
        {
          k,
          z: 1,
          step: 2,
        },
      );
      await settleRuns(c.sql);
    }
  }, 180_000);
  it("HUB-FR-107 · RA-02 · B Đạt stage 1 ∥ job stage 2 trả output ⇒ task stage 2 không superseded; join đúng 1 lần (10 vòng)", async () => {
    needPb2(c.pb2);
    for (let k = 0; k < ROUNDS; k++) {
      const { runId } = await parToStep1(c);
      await finishStages(c, runId, [1]);
      await waitStage(c.sql, runId, 1, "waiting_review");
      const j2 = await jobOfStage(c, runId, 2);
      const t1 = await taskOf(c.sql, runId, 1);
      const [rv] = await Promise.all([
        review(c, "B", t1?.id, { result: "pass" }),
        jobDone(c, j2, MD_HO),
      ]);
      expect(rv.status).toBe(200);
      await waitStage(c.sql, runId, 2, "waiting_review");
      const t2 = await taskOf(c.sql, runId, 2, "review", null);
      expect({ k, t2: t2?.status }).toEqual({ k, t2: "open" });
      await passStage(c, runId, 2, "T");
      await jobOfStage(c, runId, 3);
      expect({ k, n: (await hubRunsOf(c.sql, runId, 3)).length }).toEqual({ k, n: 1 });
      await settleRuns(c.sql);
    }
  }, 240_000);
  it("HUB-FR-118 · RA-03 · back_limit (P1b) ∥ decide stage_idx=1 (redo_limit P1a) ⇒ mỗi decision đúng stage của nó (10 vòng)", async () => {
    needPb2(c.pb2);
    for (let k = 0; k < ROUNDS; k++) {
      const s = await startInRoom(c, { key: DEFS2.par2.key, input: `RA-03 vòng ${k}` });
      await finishStages(c, s.runId, [0]);
      await passStage(c, s.runId, 0, "B");
      await finishStages(c, s.runId, [1, 2]);
      await waitStage(c.sql, s.runId, 1, "waiting_review");
      await waitStage(c.sql, s.runId, 2, "waiting_review");
      await c.sql`update hub.process_runs set back_rounds = 3 where id = ${s.runId}`;
      await c.sql`update hub.stage_runs set attempt = attempt_limit where process_run_id = ${s.runId} and stage_idx = 1`;
      const ta = await taskOf(c.sql, s.runId, 1);
      expect((await review(c, "B", ta?.id, { result: "fail", feedback: "Hết lượt" })).status).toBe(
        200,
      );
      await waitStage(c.sql, s.runId, 1, "needs_decision");
      const tb = await taskOf(c.sql, s.runId, 2);
      const [back, dec] = await Promise.all([
        review(c, "T", tb?.id, { result: "fail", feedback: "Quay về P0", back_to_step: 0 }),
        c.call("A", "POST", `/process-runs/${s.runId}/decide`, {
          option: "add_attempt",
          stage_idx: 1,
        }),
      ]);
      expect({ k, back: back.status, dec: dec.status }).toEqual({ k, back: 200, dec: 200 });
      await waitStage(c.sql, s.runId, 2, "needs_decision");
      const open = await c.sql<Json[]>`select t.reason, sr.stage_idx from hub.review_tasks t
        join hub.stage_runs sr on sr.id = t.stage_run_id
        where t.process_run_id = ${s.runId} and t.kind = 'decision' and t.status = 'open'`;
      expect({ k, open: [...open] }).toEqual({ k, open: [{ reason: "back_limit", stage_idx: 2 }] });
      expect((await stageRow(c.sql, s.runId, 1)).status).not.toBe("needs_decision");
      await waitStatus(c.sql, s.runId, "needs_decision");
      await settleRuns(c.sql);
    }
  }, 300_000);
  it("HUB-FR-118 · RA-04 · 2 decision mở (redo_limit stage 1 và 2) ⇒ decide stage_idx=2 chỉ đổi stage 2; stage 1 còn mở; decide lại stage 2 ⇒ 409 PROCESS_RUN_STATE", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.par2.key, input: "RA-04" });
    await finishStages(c, s.runId, [0]);
    await passStage(c, s.runId, 0, "B");
    await finishStages(c, s.runId, [1, 2]);
    await waitStage(c.sql, s.runId, 1, "waiting_review");
    await waitStage(c.sql, s.runId, 2, "waiting_review");
    await c.sql`update hub.stage_runs set attempt = attempt_limit where process_run_id = ${s.runId} and stage_idx in (1, 2)`;
    const ta = await taskOf(c.sql, s.runId, 1);
    expect((await review(c, "B", ta?.id, { result: "fail", feedback: "Hết lượt A" })).status).toBe(
      200,
    );
    const tb = await taskOf(c.sql, s.runId, 2);
    expect((await review(c, "T", tb?.id, { result: "fail", feedback: "Hết lượt B" })).status).toBe(
      200,
    );
    await waitStage(c.sql, s.runId, 1, "needs_decision");
    await waitStage(c.sql, s.runId, 2, "needs_decision");
    const dec = await c.call("A", "POST", `/process-runs/${s.runId}/decide`, {
      option: "add_attempt",
      stage_idx: 2,
    });
    expect(dec.status).toBe(200);
    expect((await stageRow(c.sql, s.runId, 2)).status).not.toBe("needs_decision");
    expect((await stageRow(c.sql, s.runId, 1)).status).toBe("needs_decision");
    const open = await c.sql<Json[]>`select t.reason, sr.stage_idx from hub.review_tasks t
      join hub.stage_runs sr on sr.id = t.stage_run_id
      where t.process_run_id = ${s.runId} and t.kind = 'decision' and t.status = 'open'`;
    expect([...open]).toEqual([{ reason: "redo_limit", stage_idx: 1 }]);
    const again = await c.call("A", "POST", `/process-runs/${s.runId}/decide`, {
      option: "add_attempt",
      stage_idx: 2,
    });
    expect({ status: again.status, code: (again.json as Json)?.error?.code }).toEqual({
      status: 409,
      code: "PROCESS_RUN_STATE",
    });
    await settleRuns(c.sql);
  }, 90_000);
});
