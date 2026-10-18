// AC-H41 · AC-H39 · HUB-FR-143/144 · HUB-BR-42 · plan §5–§6 (đua) · test-plan-int §3 PD-I24, PD-I39 (a)(b)(c), §9 PD-I39d:
// 2 hub quét song song bắn một hẹn đúng 1 lần (S4); bắn ∥ huỷ run; bắn `wait_until` ∥ quay lại bước; job lỗi muộn khi stage
// đã `waiting_timer`; 250 hẹn `retry` tới hạn (fixture SQL) với 2 hub × 3 lượt ⇒ 250 bắn, 250 job, 0 trùng.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { HubPa } from "../../P-a/_support/pa";
import {
  agentStage,
  type CtxPd,
  cancelRun,
  DEFS,
  defBody,
  FIELD_NGAY,
  G1,
  type Json,
  jobDone,
  mdOut,
  needPdSchema,
  nextStageJob,
  noStageJob,
  openTask,
  PA,
  PD_DEFS,
  review,
  runRow,
  SEC,
  secondHub,
  startPd,
  startRun,
  sweepN,
  timersOf,
  waitFor,
  waitStage,
  waitStageStatus,
} from "../_support/pd";
import { fireStats, insertDueRetries } from "./_bulk";
import {
  ensureDef,
  hubRunsOfStage,
  jobOfStage,
  settle,
  stageId,
  stageOutputs,
  startWait,
  sweepOn,
} from "./_wait";

let c: CtxPd;
let h2: HubPa | undefined;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterEach(async () => {
  await h2?.stop();
  h2 = undefined;
});
afterAll(async () => {
  await c?.stop();
});

const ROUNDS = 10;
/** Hub thứ hai cùng DB + cùng đồng hồ (dừng ở afterEach). */
async function hub2(): Promise<HubPa> {
  h2 = await secondHub(c, { now: c.clk.now });
  return h2;
}
/** pd-retry: job s0 lỗi tạm ⇒ stage waiting_timer + 1 hẹn retry; trả runId + job đã lỗi. */
async function toRetryWait(): Promise<{ runId: string; job: Json }> {
  await settle(c.sql);
  await ensureDef(c, PD_DEFS.retry());
  const runId = await startRun(c, "pd-retry");
  const job = await nextStageJob(c, runId);
  await c.rt.fail(job, "UPSTREAM_ERROR" as never, "lỗi tạm");
  await waitStageStatus(c, runId, 0, "waiting_timer");
  return { runId, job };
}

describe("PD-I24 · 2 hub cùng bắn một hẹn wait_until [AC-H41][S4]", () => {
  it("AC-H41 · PD-I24 · tới hạn; Promise.all(sweep hub1, sweep hub2) × 3 ⇒ đúng 1 fired_at, 1 output s1, 1 job s2", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: { ngay_het_han: "2026-11-20" } });
    await waitStageStatus(c, runId, 1, "waiting_timer");
    const other = await hub2();
    c.clk.set(new Date("2026-11-17T02:00:00Z"));
    for (let i = 0; i < 3; i++) await Promise.all([sweepN(c, 1), sweepOn(other)]);
    await waitStageStatus(c, runId, 1, "done", 0);
    const ts = await timersOf(c.sql, runId);
    expect(ts.filter((t) => t.fired_at !== null).length).toBe(1);
    expect((await stageOutputs(c.sql, runId, 1)).length).toBe(1);
    await jobOfStage(c, runId, 2);
    await noStageJob(c, runId, 1_000);
    expect(await hubRunsOfStage(c.sql, runId, 2)).toBe(1);
  }, 60_000);
});

describe("PD-I39 · đua quanh hẹn [AC-H41][plan §6]", () => {
  it("AC-H39 · PD-I39a · `sweep` ∥ `POST cancel` trên hẹn retry tới hạn (×10) ⇒ cancelled_at XOR fired_at; run cuối cancelled, không job mới sống", async () => {
    needPdSchema(c.pd);
    for (let k = 0; k < ROUNDS; k++) {
      const { runId } = await toRetryWait();
      c.clk.advance(31 * SEC);
      const [, res] = await Promise.all([sweepN(c, 1), cancelRun(c, "A", runId)]);
      expect({ k, cancel: res.status }).toEqual({ k, cancel: 200 });
      const ts = await timersOf(c.sql, runId);
      const t = ts[0] as Json;
      expect({ k, n: ts.length, xor: (t.fired_at === null) !== (t.cancelled_at === null) }).toEqual(
        {
          k,
          n: 1,
          xor: true,
        },
      );
      expect({ k, run: (await runRow(c.sql, runId)).status }).toEqual({ k, run: "cancelled" });
      if (t.fired_at !== null)
        expect({ k, s0: (await waitStageStatus(c, runId, 0, "cancelled")).status }).toEqual({
          k,
          s0: "cancelled",
        });
      expect({ k, noLiveJob: await noStageJob(c, runId, 500) }).toEqual({ k, noLiveJob: true });
    }
  }, 240_000);

  it("AC-H41 · PD-I39b · quay lại bước 0 ∥ bắn wait_until ⇒ hẹn huỷ XOR bắn; huỷ ⇒ 0 output stage chờ; run về bước 0", async () => {
    needPdSchema(c.pd);
    const def = {
      ...defBody("pd-wait-back", [
        agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }),
        waitStage({ key: "cho", step: 1 }),
        agentStage({
          key: "song",
          step: 1,
          after: { kind: "review", group_id: G1, back_to_steps: [0] },
        }),
      ]),
      ttl_days: 30,
    };
    const { runId } = await startWait(c, { fields: { ngay_het_han: "2026-11-20" }, def });
    await waitStageStatus(c, runId, 1, "waiting_timer");
    const sr = await stageId(c.sql, runId, 1);
    await jobDone(c, await jobOfStage(c, runId, 2), mdOut());
    await waitStageStatus(c, runId, 2, "waiting_review");
    const task = await openTask(c.sql, runId, "review");
    c.clk.set(new Date("2026-11-17T02:00:00Z"));
    const [rv] = await Promise.all([
      review(c, "B", task?.id, { result: "fail", feedback: "Quay về bước 0", back_to_step: 0 }),
      sweepN(c, 1),
    ]);
    expect(rv.status).toBe(200);
    const t = (await timersOf(c.sql, runId)).find((x) => x.stage_run_id === sr) as Json;
    expect((t.fired_at === null) !== (t.cancelled_at === null)).toBe(true);
    const outs = (await stageOutputs(c.sql, runId, 1)).filter((o) => o.stage_run_id === sr);
    if (t.cancelled_at !== null) expect(outs.length).toBe(0);
    await jobOfStage(c, runId, 0);
    const open = (await timersOf(c.sql, runId)).filter(
      (x) => x.fired_at === null && x.cancelled_at === null,
    );
    expect(open.length).toBe(0);
  }, 60_000);

  it("AC-H39 · PD-I39c · job lỗi muộn (sự kiện failed lần 2) khi stage đã waiting_timer ⇒ stage giữ, không hẹn thứ hai", async () => {
    needPdSchema(c.pd);
    const { runId, job } = await toRetryWait();
    const before = await waitStageStatus(c, runId, 0, "waiting_timer");
    await c.rt.fail(job as never, "UPSTREAM_ERROR" as never, "lỗi muộn");
    const ts = await waitFor(
      () => timersOf(c.sql, runId),
      (v) => v.length > 1,
      300, // sự kiện muộn: chưa có tín hiệu "đã tiêu thụ" ⇒ cửa sổ ngắn (test-plan-addendum §4)
    );
    expect((ts as Json[]).length).toBe(1);
    const after = await waitStageStatus(c, runId, 0, "waiting_timer");
    expect({ n: after.retry_count, code: after.last_error_code }).toEqual({
      n: before.retry_count,
      code: before.last_error_code,
    });
    expect(after.retry_count).toBe(1);
    expect((await runRow(c.sql, runId)).status).toBe("running");
  }, 60_000);

  it("AC-H39 · PD-I39d · 250 hẹn retry tới hạn (SQL), 2 hub `sweepOnce` song song × 3 lượt ⇒ 250 fired_at, 250 job, 0 trùng", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    const now = c.clk.now();
    const { stageRunIds } = await insertDueRetries(c.sql, {
      def: DEFS.single,
      who: PA.A,
      n: 250,
      dueAt: new Date(now.getTime() - 60 * SEC),
      now,
    });
    const other = await hub2();
    const results: Json[] = [];
    for (let i = 0; i < 3; i++)
      results.push(...(await Promise.all([sweepN(c, 1), sweepOn(other)])));
    const st = await waitFor(
      () => fireStats(c.sql, stageRunIds),
      (s) => s.jobs >= 250,
      30_000, // lưới an toàn
      (s) =>
        s.fired === 0
          ? "sweepOnce không bắn hẹn retry nào — chưa có tính năng: bắn hẹn retry theo lô (T9)"
          : null,
    );
    expect(st).toEqual({ fired: 250, open: 0, jobs: 250, dupJobs: 0, noJob: 0 });
    // Q10: tổng `SweepResult.timers` của mọi lượt = số hẹn được bắn (mỗi lượt ≤ TIMER_SWEEP_BATCH = 100).
    expect(results.reduce((a, r) => a + Number(r?.timers ?? 0), 0)).toBe(250);
    for (const r of results) expect(Number(r?.timers ?? -1)).toBeLessThanOrEqual(100);
  }, 120_000);
});
