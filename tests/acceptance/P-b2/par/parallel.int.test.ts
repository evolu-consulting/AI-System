// HUB-FR-106 · HUB-BR-38(a,b) · AC-PB2-02/03/05 · test-plan-cases §3.3 `par/parallel` (PI-01…PI-12, PI-14, PF-01…PF-03):
// engine bước song song (plan §3.1–§3.8, D2/D3/D5/D6/D9) — hub-api thật in-process + launcher thật + Runtime GIẢ claim
// `hub.jobs` (nhiều job `queued` cùng bước = "song song", R15). DB tag `pb2_par`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { jobAsk, MD_MISSING, MD_OK, noStageJob, sweep } from "../../P-a/pf1/_local";
import { answer } from "../../P-a/pf2/_local";
import { openMeStream } from "../../X2a/_x2a";
import {
  attachNames,
  type CtxPb2,
  DEFS2,
  finishStages,
  hubRunsOf,
  type Json,
  jobDone,
  jobOfStage,
  MD_HO,
  needPb2,
  PA,
  parToStep1,
  passStage,
  promptOf,
  review,
  runRow,
  settleRuns,
  stageRow,
  startInRoom,
  startPb2,
  taskOf,
  viewOf,
  waitFor,
  waitQueued,
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

const statuses = async (runId: string, idxs: number[]) =>
  Promise.all(idxs.map(async (i) => (await stageRow(c.sql, runId, i))?.status));

describe("PI · khởi động + join [AC-PB2-02][HUB-BR-38a]", () => {
  it("AC-PB2-02 · PI-01 · start pb2-auto3 ⇒ stage 0 có job; stage 1–4 pending; current_step 0, current_stage_idx 0", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.auto3.key });
    await jobOfStage(c, s.runId, 0);
    expect(await statuses(s.runId, [1, 2, 3, 4])).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    const r = await runRow(c.sql, s.runId);
    expect({ step: r.current_step, idx: r.current_stage_idx }).toEqual({ step: 0, idx: 0 });
  }, 30_000);
  it("AC-PB2-02 · PI-02 · X xong ⇒ stage 1,2,3 cùng queued, mỗi stage đúng 1 hub.runs; current_step 1; process.updated có step 1", async () => {
    needPb2(c.pb2);
    const me = await openMeStream(c.hub, await c.tok("A"));
    try {
      const s = await startInRoom(c, { key: DEFS2.auto3.key });
      await finishStages(c, s.runId, [0]);
      expect(await waitQueued(c.sql, s.runId, 3)).toEqual([1, 2, 3]);
      for (const i of [1, 2, 3])
        expect({ i, n: (await hubRunsOf(c.sql, s.runId, i)).length }).toEqual({ i, n: 1 });
      const r = await runRow(c.sql, s.runId);
      expect({ step: r.current_step, idx: r.current_stage_idx, status: r.status }).toEqual({
        step: 1,
        idx: 1,
        status: "running",
      });
      const e = await me.until(
        (x) =>
          x.event === "process.updated" && x.data?.process_run_id === s.runId && x.data?.step === 1,
      );
      expect(e).toBeDefined();
    } finally {
      me.close();
    }
  }, 30_000);
  it("AC-PB2-02 · PI-03 · pb2-par bước 1: Rà soát code Đạt (B), Test hồi quy còn chờ ⇒ stage 3 pending, 0 job mới, run waiting_review", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    await passStage(c, runId, 1, "B");
    await waitStage(c.sql, runId, 1, "done");
    expect(await noStageJob(c, runId)).toBe(true);
    expect((await stageRow(c.sql, runId, 3)).status).toBe("pending");
    await waitStatus(c.sql, runId, "waiting_review");
  }, 40_000);
  it("AC-PB2-02 · PI-04 · T Đạt Test hồi quy (sau B Đạt Rà soát) ⇒ stage 3 queued + đúng 1 job; current_step 2", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    await passStage(c, runId, 1, "B");
    await passStage(c, runId, 2, "T");
    await jobOfStage(c, runId, 3);
    expect((await hubRunsOf(c.sql, runId, 3)).length).toBe(1);
    expect((await runRow(c.sql, runId)).current_step).toBe(2);
  }, 40_000);
  it("AC-PB2-02 · PI-05 · pb2-auto3: Y1, Y3 xong, Y2 còn chạy ⇒ run running, Z chưa chạy; Y2 xong ⇒ Z; Z xong ⇒ done", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.auto3.key });
    await finishStages(c, s.runId, [0]);
    const y1 = await jobOfStage(c, s.runId, 1);
    const y2 = await jobOfStage(c, s.runId, 2);
    const y3 = await jobOfStage(c, s.runId, 3);
    await jobDone(c, y1, MD_HO);
    await jobDone(c, y3, MD_HO);
    await waitStage(c.sql, s.runId, 3, "done");
    expect((await runRow(c.sql, s.runId)).status).toBe("running");
    expect((await stageRow(c.sql, s.runId, 4)).status).toBe("pending");
    expect(await noStageJob(c, s.runId)).toBe(true);
    await jobDone(c, y2, MD_HO);
    await finishStages(c, s.runId, [4]);
    await waitStatus(c.sql, s.runId, "done");
  }, 40_000);
  it("HUB-FR-106 · PI-06 · D2 · Rà soát code waiting_review + Test hồi quy running ⇒ process_runs.status = running; task review stage 1 mở", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await finishStages(c, runId, [1]);
    await jobOfStage(c, runId, 2);
    await waitStage(c.sql, runId, 1, "waiting_review");
    expect((await runRow(c.sql, runId)).status).toBe("running");
    expect(await taskOf(c.sql, runId, 1)).toBeDefined();
  }, 40_000);
  it("HUB-FR-110 · PI-07 · stage 1 hỏi lại (waiting_answer), stage 2 running ⇒ run running; A trả lời ⇒ stage 1 chạy tiếp, stage 2 không ảnh hưởng", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    const j1 = await jobOfStage(c, runId, 1);
    await jobOfStage(c, runId, 2);
    await jobAsk(c, j1, "Phạm vi rà soát?", ["Toàn bộ", "Thay đổi"]);
    await waitStage(c.sql, runId, 1, "waiting_answer");
    expect((await runRow(c.sql, runId)).status).toBe("running");
    const ask = await taskOf(c.sql, runId, 1, "ask");
    expect((await answer(c, "A", ask?.id, { answer: "Thay đổi" })).status).toBe(200);
    await jobOfStage(c, runId, 1);
    expect((await stageRow(c.sql, runId, 2)).status).toBe("running");
  }, 40_000);
});

describe("PI · trượt/Đạt độc lập trong bước [AC-PB2-03]", () => {
  it("AC-PB2-03 · PI-08 · Rà soát code Chưa đạt 'Thiếu test', Test hồi quy Đạt ⇒ chỉ stage 1 làm lại (attempt 2, prompt có góp ý)", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    const t1 = await taskOf(c.sql, runId, 1);
    expect((await review(c, "B", t1?.id, { result: "fail", feedback: "Thiếu test" })).status).toBe(
      200,
    );
    await passStage(c, runId, 2, "T");
    const j = await jobOfStage(c, runId, 1);
    expect(promptOf(j)).toContain("Thiếu test");
    expect((await stageRow(c.sql, runId, 1)).attempt).toBe(2);
    const s2 = await stageRow(c.sql, runId, 2);
    expect({ status: s2.status, attempt: s2.attempt }).toEqual({ status: "done", attempt: 1 });
    expect((await hubRunsOf(c.sql, runId, 2)).length).toBe(1);
    expect((await stageRow(c.sql, runId, 3)).status).toBe("pending");
  }, 40_000);
  it("HUB-FR-107 · PI-09 · D6 · B Đạt stage 1 khi stage 2 còn task mở ⇒ task stage 2 vẫn open; task stage 1 closed/pass", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    const t1 = await taskOf(c.sql, runId, 1);
    const t2 = await taskOf(c.sql, runId, 2, "review", null);
    expect((await review(c, "B", t1?.id, { result: "pass" })).status).toBe(200);
    const [a] = await c.sql<
      Json[]
    >`select status, result from hub.review_tasks where id = ${t1?.id}`;
    const [b] = await c.sql<
      Json[]
    >`select status, result from hub.review_tasks where id = ${t2?.id}`;
    expect({ a, b: b?.status }).toEqual({ a: { status: "closed", result: "pass" }, b: "open" });
  }, 40_000);
  it("HUB-FR-106 · PI-10 · stage 1 thiếu mục 4 lần ⇒ needs_decision template_invalid; stage 2 vẫn tới waiting_review; bước 2 không khởi động; decision.stage_idx 1", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await finishStages(c, runId, [2]);
    for (let i = 0; i < 4; i++) await jobDone(c, await jobOfStage(c, runId, 1), MD_MISSING);
    await waitStatus(c.sql, runId, "needs_decision");
    await waitStage(c.sql, runId, 2, "waiting_review");
    expect((await stageRow(c.sql, runId, 3)).status).toBe("pending");
    const v = await viewOf(c, "A", runId);
    expect({ reason: v.json?.decision?.reason, idx: v.json?.decision?.stage_idx }).toEqual({
      reason: "template_invalid",
      idx: 1,
    });
  }, 60_000);
  it("HUB-FR-111 · PI-11 · huỷ run khi bước 1 có 2 job ⇒ cả 2 hub.runs cancelled, mọi task mở cancelled", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await jobOfStage(c, runId, 1);
    await jobOfStage(c, runId, 2);
    expect((await c.call("A", "POST", `/process-runs/${runId}/cancel`, {})).status).toBe(200);
    await waitStatus(c.sql, runId, "cancelled");
    const live = await waitFor(
      async () => [...(await hubRunsOf(c.sql, runId, 1)), ...(await hubRunsOf(c.sql, runId, 2))],
      (rs) => rs.every((r) => r.status === "cancelled"),
      8_000,
    );
    expect((live ?? []).map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
    const open = await c.sql<
      Json[]
    >`select id from hub.review_tasks where process_run_id = ${runId} and status = 'open'`;
    expect(open).toHaveLength(0);
  }, 40_000);
  it("HUB-FR-111 · PI-11b · huỷ run khi Rà soát code đã Đạt (done), Test hồi quy còn running ⇒ 200 cancelled; hub.runs stage 2 cancelled", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await jobOfStage(c, runId, 2);
    await finishStages(c, runId, [1]);
    await passStage(c, runId, 1, "B");
    await waitStage(c.sql, runId, 1, "done");
    expect((await stageRow(c.sql, runId, 2)).status).toBe("running");
    expect((await c.call("A", "POST", `/process-runs/${runId}/cancel`, {})).status).toBe(200);
    await waitStatus(c.sql, runId, "cancelled");
    const live = await waitFor(
      async () => hubRunsOf(c.sql, runId, 2),
      (rs) => rs.length > 0 && rs.every((r) => r.status === "cancelled"),
      8_000,
    );
    expect((live ?? []).map((r) => r.status)).toEqual(["cancelled"]);
  }, 40_000);
  it("HUB-FR-111 · PI-11c · huỷ run khi Rà soát code đã Đạt (done), Test hồi quy waiting_review ⇒ 200 cancelled; task review stage 2 không còn open", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    await passStage(c, runId, 1, "B");
    await waitStage(c.sql, runId, 1, "done");
    expect((await stageRow(c.sql, runId, 2)).status).toBe("waiting_review");
    expect((await c.call("A", "POST", `/process-runs/${runId}/cancel`, {})).status).toBe(200);
    await waitStatus(c.sql, runId, "cancelled");
    const open = await c.sql<
      Json[]
    >`select id from hub.review_tasks where process_run_id = ${runId} and status = 'open'`;
    expect(open).toHaveLength(0);
    const t2 = await taskOf(c.sql, runId, 2, "review", null);
    expect({ status: t2?.status, result: t2?.result }).toEqual({
      status: "closed",
      result: "cancelled",
    });
  }, 40_000);
  it("HUB-FR-111 · PI-11d · TECH-DEBT #147 · tenant_admin (không phải chủ run) huỷ run khi bước 1 có 2 stage running ⇒ 200; cả 2 hub.runs cancelled", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await jobOfStage(c, runId, 1);
    await jobOfStage(c, runId, 2);
    expect((await c.call("Adm", "POST", `/process-runs/${runId}/cancel`, {})).status).toBe(200);
    await waitStatus(c.sql, runId, "cancelled");
    const live = await waitFor(
      async () => [...(await hubRunsOf(c.sql, runId, 1)), ...(await hubRunsOf(c.sql, runId, 2))],
      (rs) => rs.length === 2 && rs.every((r) => r.status === "cancelled"),
      8_000,
    );
    expect((live ?? []).map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
  }, 40_000);
  it("HUB-FR-111 · PI-11e · TECH-DEBT #147 · stage 1 needs_decision, stage 2 còn running, tenant_admin huỷ ⇒ 200; hub.runs stage 2 cancelled", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    await jobOfStage(c, runId, 2);
    for (let i = 0; i < 4; i++) await jobDone(c, await jobOfStage(c, runId, 1), MD_MISSING);
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await stageRow(c.sql, runId, 2)).status).toBe("running");
    expect((await c.call("Adm", "POST", `/process-runs/${runId}/cancel`, {})).status).toBe(200);
    await waitStatus(c.sql, runId, "cancelled");
    const live = await waitFor(
      async () => hubRunsOf(c.sql, runId, 2),
      (rs) => rs.length > 0 && rs.every((r) => r.status === "cancelled"),
      8_000,
    );
    expect((live ?? []).map((r) => r.status)).toEqual(["cancelled"]);
  }, 60_000);
  it("AC-PB2-05 · PI-12 · pb2-real: R0a Đạt bởi B, R0b Đạt bởi T (sau) ⇒ Ghi sổ chạy; audit authorize_real_action actor = T", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.real.key });
    await finishStages(c, s.runId, [0, 1]);
    await passStage(c, s.runId, 0, "B");
    await passStage(c, s.runId, 1, "T");
    await jobOfStage(c, s.runId, 2);
    const audit = await c.sql<Json[]>`select actor_id from hub.audit_log
      where action = 'authorize_real_action' and entity_id = ${s.runId}`;
    expect(audit.map((a) => a.actor_id)).toEqual([PA.T.id]);
  }, 40_000);
  it("HUB-FR-106 · PI-14 · sweeps: bước 1 có 2 hub.runs chết ⇒ 2 timer retry (mỗi stage một), run vẫn running, 0 decision (D4/CR-083)", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    const j1 = await jobOfStage(c, runId, 1);
    const j2 = await jobOfStage(c, runId, 2);
    for (const j of [j1, j2]) {
      await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() - interval '90 seconds' where id = ${j.id}`;
      await c.sql`update hub.runs set status = 'finished', finished_at = now() - interval '90 seconds', owner = null,
          lease_until = null where id = ${j.runId}`;
    }
    await sweep(c);
    const timers = await waitFor(
      () => c.sql<Json[]>`select sr.stage_idx from hub.process_timers t
        join hub.stage_runs sr on sr.id = t.stage_run_id
        where t.process_run_id = ${runId} and t.kind = 'retry' and t.cancelled_at is null order by sr.stage_idx`,
      (v) => (v?.length ?? 0) >= 2,
      8_000,
    );
    expect(timers?.map((t) => t.stage_idx)).toEqual([1, 2]);
    expect((await c.sql`select status from hub.process_runs where id = ${runId}`)[0]?.status).toBe(
      "running",
    );
    const ds = await c.sql<Json[]>`select 1 from hub.review_tasks
      where process_run_id = ${runId} and kind = 'decision' and status = 'open'`;
    expect(ds.length).toBe(0);
  }, 40_000);
});

describe("PF · file đầu vào theo bước (R05) [HUB-FR-106]", () => {
  const has = (names: string[], idx: number, v?: number) =>
    names.some((n) => n.startsWith(v === undefined ? `s${idx}-v` : `s${idx}-v${v}-`));
  it("HUB-FR-106 · PF-01 · Tổng hợp nhận output stage 0, 1, 2; Test hồi quy (bước 1) KHÔNG có file của Rà soát code", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c);
    const j1 = await jobOfStage(c, runId, 1);
    await jobDone(c, j1, MD_HO);
    await waitStage(c.sql, runId, 1, "waiting_review");
    const j2 = await jobOfStage(c, runId, 2);
    expect({ s0: has(attachNames(j2), 0), s1: has(attachNames(j2), 1) }).toEqual({
      s0: true,
      s1: false,
    });
    await jobDone(c, j2, MD_HO);
    await passStage(c, runId, 1, "B");
    await passStage(c, runId, 2, "T");
    const j3 = await jobOfStage(c, runId, 3);
    const n = attachNames(j3);
    expect({ s0: has(n, 0), s1: has(n, 1), s2: has(n, 2) }).toEqual({
      s0: true,
      s1: true,
      s2: true,
    });
  }, 40_000);
  it("HUB-FR-106 · PF-02 · stage 1 có v1, v2 ⇒ Tổng hợp chỉ nhận v2", async () => {
    needPb2(c.pb2);
    const { runId } = await parToStep1(c, { both: true });
    const t1 = await taskOf(c.sql, runId, 1);
    expect((await review(c, "B", t1?.id, { result: "fail", feedback: "Sửa lại" })).status).toBe(
      200,
    );
    await finishStages(c, runId, [1]);
    await passStage(c, runId, 1, "B");
    await passStage(c, runId, 2, "T");
    const n = attachNames(await jobOfStage(c, runId, 3));
    expect({ v1: has(n, 1, 1), v2: has(n, 1, 2) }).toEqual({ v1: false, v2: true });
  }, 40_000);
  it("AC-PB2-01 · PF-03 · def cũ hoa-don-t stage 1 ⇒ file đầu vào = stage 0 (y như P-a)", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c);
    const j0 = await jobOfStage(c, s.runId, 0);
    await jobDone(c, j0, MD_OK);
    await passStage(c, s.runId, 0, "B");
    const n = attachNames(await jobOfStage(c, s.runId, 1));
    expect(n.some((x) => x.startsWith("s0-v1-"))).toBe(true);
  }, 40_000);
});
