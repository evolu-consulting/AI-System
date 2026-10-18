// AC-H39 · AC-H40 · HUB-FR-143 · HUB-BR-41 · PD-I01…PD-I09 (test-plan-int §1): lỗi tạm ⇒ hẹn `retry` 30/120/480 s (khoá
// `retry:<sr>:<round>:<attempt>:<n>` — A7 Q9; `SweepResult.timers` — A7 Q10), cạn lượt ⇒ `retry_exhausted`; `interrupted` thử lại;
// đã gửi `side_effect` (D-PD03) ⇒ quyết ngay; lỗi nghiệp vụ / template / mất quyền ⇒ quyết ngay. Trước code: đỏ ở `needPdSchema`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  DEFS,
  decide,
  decisionOf,
  type Job,
  type Json,
  jobDone,
  jobsOfRun,
  MD_MISSING,
  mdOut,
  needPdSchema,
  nextStageJob,
  noStageJob,
  P1,
  PA,
  review,
  runRow,
  stageOf,
  startPd,
  startRun,
  sweepN,
  T,
  timersOf,
  toGate,
  viewRun,
  waitFor,
  waitStageStatus,
  waitStatus,
} from "../_support/pd";
import {
  decisionsOf,
  ensureDef,
  ensureWorkflows,
  expectRetryDue,
  failJob,
  fireAndTake,
  fireOpen,
  hubRunsOfStage,
  insertToolStep,
  interruptJob,
  openRetry,
  retryTimers,
  settle,
  viewStage,
  WF_PD,
} from "./_retry";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settle(c);
});
afterAll(async () => {
  await c?.stop();
});

const BACKOFF = [30, 120, 480];
const ms = (v: unknown) => new Date(v as string).getTime();
const upstream = (j: Job) => () => c.rt.fail(j, "UPSTREAM_ERROR", "lỗi", null);
const timeout = (j: Job) => () => c.rt.fail(j, "TIMEOUT", "quá hạn", "timeout", "timed_out");

/** `pd-retry` bắt đầu ⇒ job s0. */
async function startRetry(): Promise<{ runId: string; job: Job; sr: Json }> {
  const runId = await startRun(c, await ensureDef(c, "retry"));
  const job = await nextStageJob(c, runId);
  return { runId, job, sr: (await stageOf(c.sql, runId, 0)) as Json };
}
/** Lỗi tạm `n` lần (mỗi lần bắn hẹn) ⇒ trả job mới nhất (đang chạy). */
async function failTimes(runId: string, job: Job, n: number, how = upstream): Promise<Job> {
  let j = job;
  for (let i = 0; i < n; i++) {
    const f = await failJob(c, runId, 0, how(j));
    expect({ i, status: f.stage.status }).toEqual({ i, status: "waiting_timer" });
    j = await fireAndTake(c, runId);
  }
  return j;
}

describe("PD-I01…I05 · lỗi tạm ⇒ thử lại [AC-H39 · HUB-FR-143 · HUB-BR-41]", () => {
  it("AC-H39 · PD-I01 · UPSTREAM_ERROR × 3 ⇒ hẹn 30/120/480 s, khoá `retry:<sr>:1:1:n`, bắn đúng giờ, 1 job/lần; lần 4 xong ⇒ s1 chạy", async () => {
    needPdSchema(c.pd);
    const first = await startRetry();
    const { runId, sr } = first;
    let job = first.job;
    for (let n = 1; n <= 3; n++) {
      const f = await failJob(c, runId, 0, upstream(job));
      expect(f.stage).toMatchObject({
        status: "waiting_timer",
        retry_count: n,
        last_error_code: "UPSTREAM_ERROR",
        current_run_id: null,
        attempt: 1,
        round: 1,
      });
      expect((await runRow(c.sql, runId)).status).toBe("running");
      const t = await expectRetryDue(c, runId, f, BACKOFF[n - 1] as number);
      expect(t.idempotency_key).toMatch(new RegExp(`^retry:${sr.id}:1:1:${n}$`));
      expect(t.timezone).toBeNull();
      expect(await retryTimers(c.sql, runId)).toHaveLength(n);
      const v = await viewStage(c, runId, 0);
      expect({ retry: v?.retry_count, next: ms(v?.next_retry_at) }).toEqual({
        retry: n,
        next: ms(t.due_at),
      });
      if (n === 1) {
        c.clk.set(new Date(ms(t.due_at) - 1_000)); // T0 + 29 s
        expect((await sweepN(c))?.timers).toBe(0);
        expect(await noStageJob(c, runId)).toBe(true);
      }
      const { sweep } = await fireOpen(c, runId);
      expect(sweep?.timers).toBe(1);
      const fired = (await timersOf(c.sql, runId)).find((x) => x.id === t.id);
      expect(fired?.fired_at).not.toBeNull();
      job = await nextStageJob(c, runId);
      expect(await jobsOfRun(c.sql, runId)).toHaveLength(n + 1);
      const s = await stageOf(c.sql, runId, 0);
      expect({ attempt: s?.attempt, round: s?.round }).toEqual({ attempt: 1, round: 1 });
    }
    await jobDone(c, job, mdOut());
    await waitStageStatus(c, runId, 0, "done");
    await nextStageJob(c, runId); // s1 có job
    const hr = await hubRunsOfStage(c.sql, sr.id);
    expect(hr.map((r) => r.status)).toEqual(["failed", "failed", "failed", "finished"]);
  }, 60_000);

  it("AC-H39 · PD-I02 · lỗi tạm lần 4 ⇒ needs_decision `retry_exhausted` [add_attempt, cancel]; add_attempt ⇒ job ngay, đếm về 0; lỗi kế ⇒ khoá `:4`", async () => {
    needPdSchema(c.pd);
    const { runId, job } = await startRetry();
    const j4 = await failTimes(runId, job, 3);
    const f = await failJob(c, runId, 0, upstream(j4));
    expect(f.stage.status).toBe("needs_decision");
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("retry_exhausted");
    const v = await viewRun(c, "A", runId);
    expect(v.json?.decision).toMatchObject({
      reason: "retry_exhausted",
      options: ["add_attempt", "cancel"],
    });
    expect(await openRetry(c.sql, runId)).toHaveLength(0);
    const d = await decide(c, "A", runId, "add_attempt");
    expect(d.status).toBeLessThan(300);
    const j5 = await nextStageJob(c, runId); // ngay — không sweep
    expect(await retryTimers(c.sql, runId)).toHaveLength(3);
    const s = await stageOf(c.sql, runId, 0);
    expect({ rc: s?.retry_count, code: s?.last_error_code, attempt: s?.attempt }).toEqual({
      rc: 0,
      code: null,
      attempt: 1,
    });
    const f2 = await failJob(c, runId, 0, upstream(j5));
    expect(f2.stage.status).toBe("waiting_timer");
    const [t] = await openRetry(c.sql, runId);
    expect(String(t?.idempotency_key)).toMatch(/:4$/);
  }, 60_000);

  it("AC-H39 · PD-I03 · hub.run của s0 kết thúc 90 s trước + sweep ⇒ không needs_decision; waiting_timer, INTERRUPTED, hẹn +30 s; bắn ⇒ job mới cùng attempt", async () => {
    needPdSchema(c.pd);
    const { runId, job } = await startRetry();
    await interruptJob(c, job);
    const t0 = c.clk.now().getTime();
    await sweepN(c);
    const st = await waitStageStatus(c, runId, 0, "waiting_timer", 0); // sau sweep đã await ⇒ đo một lần
    const t1 = c.clk.now().getTime();
    expect(st).toMatchObject({ retry_count: 1, last_error_code: "INTERRUPTED", attempt: 1 });
    expect(await decisionOf(c.sql, runId)).toBeUndefined();
    expect((await runRow(c.sql, runId)).status).toBe("running");
    await expectRetryDue(c, runId, { t0, t1 }, 30);
    await fireAndTake(c, runId);
    expect((await stageOf(c.sql, runId, 0))?.attempt).toBe(1);
  }, 60_000);

  it("AC-H39 · PD-I04 · TIMEOUT (reason timeout, timed_out) × 4 ⇒ lần 1–3 hẹn retry; lần 4 `retry_exhausted` (không `job_timeout`)", async () => {
    needPdSchema(c.pd);
    const { runId, job } = await startRetry();
    const j4 = await failTimes(runId, job, 3, timeout);
    expect((await stageOf(c.sql, runId, 0))?.last_error_code).toBe("TIMEOUT");
    await failJob(c, runId, 0, timeout(j4));
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("retry_exhausted");
    expect(await retryTimers(c.sql, runId)).toHaveLength(3);
  }, 60_000);

  it("AC-H39 · PD-I05 · 2 agent song song bước 1 cùng chết × 4 vòng ⇒ 2 hẹn mỗi vòng; cuối 2 decision `retry_exhausted`, view.decision = cũ nhất", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, await ensureDef(c, "par2"));
    await jobDone(c, await nextStageJob(c, runId), mdOut());
    for (let round = 1; round <= 4; round++) {
      const ja = await nextStageJob(c, runId);
      const jb = await nextStageJob(c, runId);
      await interruptJob(c, ja);
      await interruptJob(c, jb);
      await sweepN(c);
      if (round === 4) break;
      await waitStageStatus(c, runId, 1, "waiting_timer", 0);
      await waitStageStatus(c, runId, 2, "waiting_timer", 0);
      const open = await openRetry(c.sql, runId);
      expect({ round, open: open.length }).toEqual({ round, open: 2 });
      expect(new Set(open.map((t) => t.stage_run_id)).size).toBe(2);
      c.clk.set(new Date(Math.max(...open.map((t) => ms(t.due_at))) + 50));
      await sweepN(c);
    }
    await waitStatus(c.sql, runId, "needs_decision", 0);
    const ds = await waitForDecisions(runId, 2);
    expect(ds.map((d) => d.reason)).toEqual(["retry_exhausted", "retry_exhausted"]);
    expect(await retryTimers(c.sql, runId)).toHaveLength(6);
    const v = await viewRun(c, "A", runId);
    expect(v.json?.decision?.stage_idx).toBe(ds[0]?.stage_idx);
  }, 60_000);
});

describe("PD-I06…I08 · `side_effect` đã gửi (D-PD03) [AC-H40 · HUB-BR-41]", () => {
  /** `hoa-don-t` tới stage 2 (`real_action`, B Đạt) ⇒ job stage 2 + hàng stage. */
  async function realStage2(): Promise<{ runId: string; job: Job; stage: Json }> {
    const g = await toGate(c);
    expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
    const job = await nextStageJob(c, g.runId);
    return { runId: g.runId, job, stage: (await stageOf(c.sql, g.runId, 1)) as Json };
  }
  const toolSteps = async (stageRunId: string) =>
    (
      await c.sql<{ n: number }[]>`select count(*)::int as n from hub.run_steps rs
        join hub.runs r on r.id = rs.run_id where r.stage_run_id = ${stageRunId}
        and rs.type in ('tool', 'workflow')`
    )[0]?.n;
  const tmo = (j: Job) => () => c.rt.fail(j, "TIMEOUT", "quá hạn", null, "timed_out");

  it("AC-H40 · PD-I06 · stage real_action đã gọi `ghi-so` (side_effect, ok) rồi TIMEOUT ⇒ needs_decision `job_timeout`; 0 hẹn retry; tool 1 lần", async () => {
    needPdSchema(c.pd);
    await ensureWorkflows(c.sql);
    const s = await realStage2();
    await insertToolStep(c, s.job.runId, WF_PD.ghiSo, "ok");
    await failJob(c, s.runId, 1, tmo(s.job));
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await decisionOf(c.sql, s.runId))?.reason).toBe("job_timeout");
    expect(await retryTimers(c.sql, s.runId)).toHaveLength(0);
    expect(await toolSteps(s.stage.id)).toBe(1);
  }, 60_000);

  it("AC-H40 · PD-I07 · bước tool `ghi-so` status `skipped` ⇒ chưa gửi ⇒ TIMEOUT thử lại (hẹn retry)", async () => {
    needPdSchema(c.pd);
    await ensureWorkflows(c.sql);
    const s = await realStage2();
    await insertToolStep(c, s.job.runId, WF_PD.ghiSo, "skipped");
    const f = await failJob(c, s.runId, 1, tmo(s.job));
    expect(f.stage.status).toBe("waiting_timer");
    expect(await openRetry(c.sql, s.runId)).toHaveLength(1);
    expect(await decisionOf(c.sql, s.runId)).toBeUndefined();
  }, 60_000);

  it("AC-H40 · PD-I08 · workflow `side_effect=false` đã gọi (ok) ⇒ TIMEOUT thử lại (hẹn retry)", async () => {
    needPdSchema(c.pd);
    await ensureWorkflows(c.sql);
    const s = await realStage2();
    await insertToolStep(c, s.job.runId, WF_PD.nhap, "ok");
    const f = await failJob(c, s.runId, 1, tmo(s.job));
    expect(f.stage.status).toBe("waiting_timer");
    expect(await openRetry(c.sql, s.runId)).toHaveLength(1);
  }, 60_000);
});

describe("PD-I09 · lỗi nghiệp vụ ⇒ quyết ngay [AC-H40 · HUB-FR-143]", () => {
  const BUSINESS: [
    string,
    "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "ALL_PROVIDERS_EXHAUSTED" | "INTERNAL_ERROR",
    Json,
  ][] = [
    ["NOT_CONFIGURED+credential", "NOT_CONFIGURED", "credential"],
    ["UPSTREAM_ERROR+refused", "UPSTREAM_ERROR", "refused"],
    ["ALL_PROVIDERS_EXHAUSTED+quota", "ALL_PROVIDERS_EXHAUSTED", "quota"],
    ["INTERNAL_ERROR reason null (mã lạ ⇒ nghiệp vụ, A2)", "INTERNAL_ERROR", null],
  ];
  for (const [name, code, reason] of BUSINESS) {
    it(`AC-H40 · PD-I09 · ${name} ⇒ needs_decision \`agent_failed\` ngay; retry_count 0; 0 hẹn retry`, async () => {
      needPdSchema(c.pd);
      const { runId, job } = await startRetry();
      const f = await failJob(c, runId, 0, () => c.rt.fail(job, code, "lỗi nghiệp vụ", reason));
      expect({ status: f.stage.status, rc: f.stage.retry_count }).toEqual({
        status: "needs_decision",
        rc: 0,
      });
      await waitStatus(c.sql, runId, "needs_decision");
      expect((await decisionOf(c.sql, runId))?.reason).toBe("agent_failed");
      expect(await retryTimers(c.sql, runId)).toHaveLength(0);
    }, 60_000);
  }

  it("AC-H40 · PD-I09 · output thiếu `## Tổng tiền` (MD_MISSING) × 4 ⇒ `template_invalid` (luật P-a giữ); retry_count 0; 0 hẹn retry", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, DEFS.hd.key, { input: "HD-12 tháng 9" });
    for (let i = 0; i < 4; i++) await jobDone(c, await nextStageJob(c, runId), MD_MISSING);
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await decisionOf(c.sql, runId))?.reason).toBe("template_invalid");
    expect((await stageOf(c.sql, runId, 0))?.retry_count).toBe(0);
    expect(await retryTimers(c.sql, runId)).toHaveLength(0);
  }, 60_000);

  it("AC-H40 · PD-I09 · thu hồi grant A (hd-read) trước khi bắn hẹn retry ⇒ `permission_lost`, không job mới, không hẹn mở", async () => {
    needPdSchema(c.pd);
    const { runId, job } = await startRetry();
    await failJob(c, runId, 0, upstream(job));
    await c.sql`delete from hub.agent_grants where agent_id = ${P1.agRead} and subject_id = ${PA.A.id}`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    try {
      await fireOpen(c, runId);
      await waitStatus(c.sql, runId, "needs_decision");
      expect((await decisionOf(c.sql, runId))?.reason).toBe("permission_lost");
      expect(await jobsOfRun(c.sql, runId)).toHaveLength(1);
      expect(await openRetry(c.sql, runId)).toHaveLength(0);
    } finally {
      await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${P1.agRead}, ${T.acme}, 'user', ${PA.A.id}) on conflict do nothing`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    }
  }, 60_000);
});

async function waitForDecisions(runId: string, n: number): Promise<Json[]> {
  const ds = await waitFor(
    () => decisionsOf(c.sql, runId),
    (v) => v.length >= n,
    8_000,
  );
  expect(ds).toHaveLength(n);
  return [...ds];
}
