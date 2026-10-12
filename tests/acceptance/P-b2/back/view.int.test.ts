// HUB-FR-113 · HUB-BR-25 · AC-PB2-11 · test-plan-cases §3.4 `back/view` (BV-01…BV-05): `GET /process-runs/:id` có
// `current_step`, `step_count`, `StageView.step/round/back_to_steps`, `back_rounds`, `back_limit`, `back_events` (≤ 20, cũ→mới);
// người ngoài phòng (access `task`) KHÔNG có `back_events`; tenant khác ⇒ 404. DB tag `pb2_back`. 0024 vắng ⇒ `needPb2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { loadChat } from "../_support/_modules";
import {
  backToB3,
  type CtxPb2,
  finishStages,
  type Json,
  jobDone,
  jobOfStage,
  MD_HO,
  needPb2,
  PA,
  parToStep1,
  passStage,
  review,
  startPb2,
  T,
  taskOf,
  viewOf,
  waitStage,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterAll(() => c?.stop());

/** Từ B1 đã chạy lại (round r) đi tiếp tới B3 waiting_review rồi quay lại bước 1. */
async function againBack(runId: string, fb: string): Promise<void> {
  await jobDone(c, await jobOfStage(c, runId, 1), MD_HO);
  await passStage(c, runId, 1, "B");
  await finishStages(c, runId, [2, 3]);
  await waitStage(c.sql, runId, 3, "waiting_review");
  const t = await taskOf(c.sql, runId, 3);
  expect(
    (await review(c, "B", t?.id, { result: "fail", feedback: fb, back_to_step: 1 })).status,
  ).toBe(200);
}

describe("BV · view theo bước + lịch sử quay lại [HUB-FR-113][AC-PB2-11]", () => {
  it("HUB-FR-113 · BV-01 · sau 2 lần quay lại ⇒ back_rounds 2, back_limit 3, back_events 2 phần tử cũ→mới round 2, 3; parse ProcessRunFullViewSchema ok", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c);
    expect(
      (await review(c, "B", g.taskId, { result: "fail", feedback: "Lần 1", back_to_step: 1 }))
        .status,
    ).toBe(200);
    await againBack(g.runId, "Lần 2");
    const v = (await viewOf(c, "A", g.runId)).json;
    expect({ rounds: v?.back_rounds, limit: v?.back_limit }).toEqual({ rounds: 2, limit: 3 });
    expect(
      ((v?.back_events ?? []) as Json[]).map((e) => [
        e.round,
        e.feedback,
        e.to_step,
        e.from_stage_idx,
      ]),
    ).toEqual([
      [2, "Lần 1", 1, 3],
      [3, "Lần 2", 1, 3],
    ]);
    const ch = await loadChat();
    expect(ch.ProcessRunFullViewSchema?.safeParse?.(v)?.success).toBe(true);
  }, 90_000);
  it("HUB-FR-113 · BV-02 · 21 event (SQL) ⇒ back_events = 20 mới nhất, cũ→mới", async () => {
    needPb2(c.pb2);
    const g = await backToB3(c);
    const base = Date.now() - 3_600_000;
    for (let i = 1; i <= 21; i++)
      await c.sql`insert into hub.process_back_events ${c.sql({
        tenant_id: T.acme,
        process_run_id: g.runId,
        task_id: null,
        from_stage_idx: 3,
        from_step: 3,
        to_step: 1,
        round_after: 2,
        feedback: `E${i}`,
        decided_by: PA.B.id,
        created_at: new Date(base + i * 1_000),
      })}`;
    const v = (await viewOf(c, "A", g.runId)).json;
    expect(((v?.back_events ?? []) as Json[]).map((e) => e.feedback)).toEqual(
      Array.from({ length: 20 }, (_, i) => `E${i + 2}`),
    );
  }, 60_000);
  it("HUB-FR-104 · BV-03 · pb2-par: summary current_step 1, step_count 3; StageView step/round/back_to_steps", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    const v = (await viewOf(c, "A", runId)).json;
    expect({ step: v?.current_step, count: v?.step_count, n: v?.stage_count }).toEqual({
      step: 1,
      count: 3,
      n: 4,
    });
    expect(
      ((v?.stages ?? []) as Json[]).map((s) => [s.idx, s.step, s.round, s.back_to_steps]),
    ).toEqual([
      [0, 0, 1, []],
      [1, 1, 1, []],
      [2, 1, 1, [0]],
      [3, 2, 1, [0, 1]],
    ]);
  }, 60_000);
  it("AC-PB2-11 · BV-04 · H (ngoài phòng, có task) ⇒ access task: không khoá back_events; stages có step/round", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    const t2 = await taskOf(c.sql, runId, 2);
    await c.sql`insert into hub.review_task_assignees ${c.sql({
      tenant_id: T.acme,
      task_id: t2?.id,
      user_id: PA.H.id,
      via: "initial",
      depth: 0,
    })}`;
    const v = await viewOf(c, "H", runId);
    expect(v.status).toBe(200);
    expect(v.json?.access).toBe("task");
    expect("back_events" in (v.json ?? {})).toBe(false);
    expect(((v.json?.stages ?? []) as Json[]).map((s) => [s.idx, s.step, s.round])).toEqual([
      [0, 0, 1],
      [1, 1, 1],
      [2, 1, 1],
      [3, 2, 1],
    ]);
  }, 60_000);
  it("HUB-BR-25 · BV-05 · tenant beta GET run acme ⇒ 404", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    expect((await viewOf(c, "D", runId)).status).toBe(404);
  }, 60_000);
});
