// HUB-FR-107 · AC-H28 · HUB-BR-26 · M5 · P1-40…P1-47, P1-51 (test-plan-int §2): cổng kiểm `POST /review-tasks/:id/decision`,
// `POST /process-runs/:id/{decide,cancel}`, mở task decision (assignee user A + group duyệt chỉ khi `redo_limit`).
// Run thật (launcher PF1 + runtime giả) khi ca cần job/prompt; run SQL fixture (`insertRun`…) cho ca chỉ cần trạng thái.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  type Role,
  type Sql,
  waitFor,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  jobDone,
  MD_OK,
  nextStageJob,
  openTask,
  P1,
  review,
  runRow,
  stageHubRuns,
  stageRow,
  startInRoom,
  startPf1,
  toGate,
  waitStatus,
} from "./_local";

let c: CtxPf1;
beforeAll(async () => {
  // Fixture run cố ý để active (needs_decision/waiting_review) tích luỹ > 5 → nâng giới hạn run/tenant (file này không test giới hạn).
  c = await startPf1({ processRunsPerTenant: 200 });
  if (!c.ready) return;
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const OPTS3 = ["add_attempt", "use_current", "cancel"];
const code = (r: { json: Json }) => r.json?.error?.code;
const decide = (r: Role, runId: string, option: string) =>
  c.call(r, "POST", `/process-runs/${runId}/decide`, { option });
const cancel = (r: Role, runId: string) => c.call(r, "POST", `/process-runs/${runId}/cancel`, {});

/** Kết thúc mọi `hub.runs` của process run bằng SQL (giữ giới hạn run đồng thời của A). */
async function endHubRuns(sql: Sql, processRunId: string): Promise<void> {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now()
    where run_id in (select id from hub.runs where process_run_id = ${processRunId}) and status in ('queued','running')`;
  await sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where process_run_id = ${processRunId} and status = 'running'`;
}

/** Run SQL ở gate 1: `waiting_review`, output v1, task review gán group Kế toán. */
async function gateFix(o: { attempt?: number } = {}) {
  const run = await insertRun(c.sql, {
    def: DEFS.hd,
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
  const s0 = run.stageRunIds[0] as string;
  const outputId = await insertOutput(c.sql, {
    tid: PA.A.tid,
    runId: run.runId,
    stageRunId: s0,
    stageIdx: 0,
  });
  await c.sql`update hub.stage_runs set current_output_id = ${outputId}, attempt = ${o.attempt ?? 1} where id = ${s0}`;
  const taskId = await insertTask(c.sql, {
    tid: PA.A.tid,
    runId: run.runId,
    stageRunId: s0,
    kind: "review",
    outputId,
    groupId: PA_FIX.gKeToan,
  });
  return { ...run, outputId, taskId };
}

/** Run SQL `needs_decision` lý do `reason` (stage 0 attempt 4/4), task decision theo `decisionAssignees`. */
async function decisionFix(reason: string, o: { output?: boolean } = {}) {
  const hasOutput = o.output ?? true;
  const options = hasOutput ? OPTS3 : ["add_attempt", "cancel"];
  const run = await insertRun(c.sql, {
    def: DEFS.hd,
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "needs_decision",
    decision: { reason, stage_idx: 0, options, at: new Date().toISOString() },
  });
  const s0 = run.stageRunIds[0] as string;
  await c.sql`update hub.stage_runs set attempt = 4, attempt_limit = 4 where id = ${s0}`;
  if (hasOutput) {
    const outputId = await insertOutput(c.sql, {
      tid: PA.A.tid,
      runId: run.runId,
      stageRunId: s0,
      stageIdx: 0,
    });
    await c.sql`update hub.stage_runs set current_output_id = ${outputId} where id = ${s0}`;
  }
  const taskId = await insertTask(c.sql, {
    tid: PA.A.tid,
    runId: run.runId,
    stageRunId: s0,
    kind: "decision",
    reason,
    userIds: [PA.A.id],
    groupId: reason === "redo_limit" ? PA_FIX.gKeToan : null,
  });
  return { ...run, taskId };
}

describe("P1-40…P1-43 · Đạt / Chưa đạt [AC-H28 · HUB-FR-107]", () => {
  it("AC-H28 · P1-40 · Chưa đạt thiếu góp ý / góp ý '   ' ⇒ 422 FEEDBACK_REQUIRED; task vẫn open", async () => {
    needSchema(c.ready);
    const g = await gateFix();
    for (const body of [{ result: "fail" }, { result: "fail", feedback: "   " }]) {
      const r = await review(c, "B", g.taskId, body);
      expect({ status: r.status, code: code(r) }).toEqual({
        status: 422,
        code: "FEEDBACK_REQUIRED",
      });
    }
    const [t] = await c.sql<Json[]>`select status from hub.review_tasks where id = ${g.taskId}`;
    expect(t?.status).toBe("open");
    expect((await runRow(c.sql, g.runId)).status).toBe("waiting_review");
  }, 30_000);

  it("AC-H28 · P1-41 · B Chưa đạt 'Thiếu MST' ⇒ 200 TaskDetail fail; attempt 2, job mới prompt chứa góp ý; history `review`", async () => {
    needSchema(c.ready);
    const g = await toGate(c);
    const r = await review(c, "B", g.taskId, { result: "fail", feedback: "Thiếu MST" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id: g.taskId,
      kind: "review",
      status: "closed",
      result: "fail",
    });
    const job = await nextStageJob(c, g.runId);
    expect(job.payload.prompt).toContain("Thiếu MST");
    const s0 = await stageRow(c.sql, g.runId, 0);
    expect(s0.attempt).toBe(2);
    const v = await c.call("A", "GET", `/process-runs/${g.runId}`);
    expect(v.status).toBe(200);
    const h = (v.json?.history ?? []) as Json[];
    expect(
      h.some(
        (x) =>
          x.kind === "review" &&
          x.result === "fail" &&
          x.feedback === "Thiếu MST" &&
          x.actor?.id === PA.B.id,
      ),
    ).toBe(true);
    await jobDone(c, job, MD_OK);
    await waitStatus(c.sql, g.runId, "waiting_review");
    await endHubRuns(c.sql, g.runId);
  }, 40_000);

  it("AC-H28 · P1-42 · B Đạt ⇒ stage 2 chạy (1 `hub.runs` mới), `passed_by`=B", async () => {
    needSchema(c.ready);
    const g = await toGate(c);
    const before = (await stageHubRuns(c.sql, g.runId)).length;
    const r = await review(c, "B", g.taskId, { result: "pass" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: g.taskId, result: "pass" });
    const runs = await waitFor(
      () => stageHubRuns(c.sql, g.runId),
      (xs) => xs.length === before + 1,
      8_000,
    );
    expect(runs).toHaveLength(before + 1);
    const s1 = await stageRow(c.sql, g.runId, 1);
    expect(runs.at(-1)?.stage_run_id).toBe(s1.id);
    expect(runs.at(-1)?.user_id).toBe(PA.A.id);
    const s0 = await stageRow(c.sql, g.runId, 0);
    expect({ status: s0.status, passed_by: s0.passed_by }).toEqual({
      status: "done",
      passed_by: PA.B.id,
    });
    expect((await runRow(c.sql, g.runId)).current_stage_idx).toBe(1);
    await endHubRuns(c.sql, g.runId);
  }, 40_000);

  it("AC-H28 · P1-43 · Chưa đạt lần 4 (attempt 4) ⇒ needs_decision `redo_limit`, task decision open, options 3", async () => {
    needSchema(c.ready);
    const g = await gateFix({ attempt: 4 });
    const r = await review(c, "B", g.taskId, { result: "fail", feedback: "Vẫn thiếu MST" });
    expect(r.status).toBe(200);
    const run = await waitStatus(c.sql, g.runId, "needs_decision");
    expect(run.decision).toMatchObject({ reason: "redo_limit", stage_idx: 0, options: OPTS3 });
    const t = await openTask(c.sql, g.runId, "decision");
    expect(t).toMatchObject({ kind: "decision", status: "open", reason: "redo_limit" });
    const v = await c.call("A", "GET", `/process-runs/${g.runId}`);
    expect(v.json?.decision).toMatchObject({
      reason: "redo_limit",
      options: OPTS3,
      can_decide: true,
    });
  }, 30_000);
});

describe("P1-44…P1-46 · decide + cancel [M5 · §3]", () => {
  it("HUB-FR-107 · P1-44 · add_attempt bởi B (Group kiểm) ⇒ 200 attempt_limit=5 chạy lại", async () => {
    needSchema(c.ready);
    const d = await decisionFix("redo_limit");
    const r = await decide("B", d.runId, "add_attempt");
    expect(r.status).toBe(200);
    expect(r.json?.access).toBe("full");
    const s0 = await stageRow(c.sql, d.runId, 0);
    expect(s0.attempt_limit).toBe(5);
    expect(["queued", "running"]).toContain(s0.status);
    expect((await runRow(c.sql, d.runId)).status).toBe("running");
    await waitFor(
      () => stageHubRuns(c.sql, d.runId),
      (xs) => xs.length > 0,
      5_000,
    );
    await endHubRuns(c.sql, d.runId);
  }, 30_000);

  it("HUB-FR-107 · P1-44 · X (thành viên, không Group) ⇒ 403 NOT_PROCESS_DECIDER; T (Group ngoài phòng, Q2) ⇒ 200", async () => {
    needSchema(c.ready);
    const d = await decisionFix("redo_limit");
    const rx = await decide("X", d.runId, "add_attempt");
    expect({ status: rx.status, code: code(rx) }).toEqual({
      status: 403,
      code: "NOT_PROCESS_DECIDER",
    });
    expect((await runRow(c.sql, d.runId)).status).toBe("needs_decision");
    const rt = await decide("T", d.runId, "add_attempt");
    expect(rt.status).toBe(200);
    expect((await stageRow(c.sql, d.runId, 0)).attempt_limit).toBe(5);
    await waitFor(
      () => stageHubRuns(c.sql, d.runId),
      (xs) => xs.length > 0,
      5_000,
    );
    await endHubRuns(c.sql, d.runId);
  }, 30_000);

  it("HUB-FR-107 · P1-45 · use_current (redo_limit) ⇒ như Đạt: stage 0 done, stage 2 chạy", async () => {
    needSchema(c.ready);
    const d = await decisionFix("redo_limit");
    const r = await decide("A", d.runId, "use_current");
    expect(r.status).toBe(200);
    const run = await runRow(c.sql, d.runId);
    expect({ status: run.status, idx: run.current_stage_idx }).toEqual({
      status: "running",
      idx: 1,
    });
    expect((await stageRow(c.sql, d.runId, 0)).status).toBe("done");
    const [t] = await c.sql<
      Json[]
    >`select status, result from hub.review_tasks where id = ${d.taskId}`;
    expect(t).toMatchObject({ status: "closed", result: "use_current" });
    await waitFor(
      () => stageHubRuns(c.sql, d.runId),
      (xs) => xs.length > 0,
      5_000,
    );
    await endHubRuns(c.sql, d.runId);
  }, 30_000);

  it("HUB-FR-107 · P1-45 · use_current chưa output ⇒ 409 NO_OUTPUT; run không ở needs_decision ⇒ 409 PROCESS_RUN_STATE; B với `team_calls` ⇒ 403", async () => {
    needSchema(c.ready);
    const noOut = await decisionFix("redo_limit", { output: false });
    const r1 = await decide("A", noOut.runId, "use_current");
    expect({ status: r1.status, code: code(r1) }).toEqual({ status: 409, code: "NO_OUTPUT" });
    const g = await gateFix();
    const r2 = await decide("A", g.runId, "add_attempt");
    expect({ status: r2.status, code: code(r2) }).toEqual({
      status: 409,
      code: "PROCESS_RUN_STATE",
    });
    const tc = await decisionFix("team_calls");
    const r3 = await decide("B", tc.runId, "add_attempt");
    expect({ status: r3.status, code: code(r3) }).toEqual({
      status: 403,
      code: "NOT_PROCESS_DECIDER",
    });
  }, 30_000);

  it("HUB-FR-107 · P1-46 · A huỷ run đang chạy ⇒ 200 cancelled, `hub.runs` stage huỷ; lần 2 ⇒ 409 PROCESS_RUN_STATE", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c);
    await nextStageJob(c, s.runId);
    const r = await cancel("A", s.runId);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: s.runId, status: "cancelled" });
    const runs = await waitFor(
      () => stageHubRuns(c.sql, s.runId),
      (xs) => xs.length > 0 && xs.every((x) => x.status !== "running"),
      8_000,
    );
    expect(runs.every((x) => x.status !== "running")).toBe(true);
    const again = await cancel("A", s.runId);
    expect({ status: again.status, code: code(again) }).toEqual({
      status: 409,
      code: "PROCESS_RUN_STATE",
    });
  }, 30_000);

  it("HUB-FR-107 · P1-46 · tadmin huỷ ⇒ 200 (task đóng `cancelled`); B, T ⇒ 403 NOT_PROCESS_DECIDER; H ⇒ 404", async () => {
    needSchema(c.ready);
    const g = await gateFix();
    for (const who of ["B", "T"] as Role[]) {
      const r = await cancel(who, g.runId);
      expect({ who, status: r.status, code: code(r) }).toEqual({
        who,
        status: 403,
        code: "NOT_PROCESS_DECIDER",
      });
    }
    const rh = await cancel("H", g.runId);
    expect(rh.status).toBe(404);
    const ra = await cancel("Adm", g.runId);
    expect(ra.status).toBe(200);
    expect((await runRow(c.sql, g.runId)).status).toBe("cancelled");
    const [t] = await c.sql<
      Json[]
    >`select status, result from hub.review_tasks where id = ${g.taskId}`;
    expect(t).toMatchObject({ status: "closed", result: "cancelled" });
  }, 30_000);
});

describe("P1-47 · Đạt đồng thời [FR-107]", () => {
  it("HUB-FR-107 · P1-47 · B ∥ T Đạt ×10 ⇒ mỗi vòng 1×200 + 1×409 REVIEW_TASK_CLOSED; đúng 1 stage 2", async () => {
    needSchema(c.ready);
    for (let i = 0; i < 10; i++) {
      const g = await gateFix();
      const rs = await Promise.all([
        review(c, "B", g.taskId, { result: "pass" }),
        review(c, "T", g.taskId, { result: "pass" }),
      ]);
      const got = rs.map((r) => `${r.status}${r.status === 409 ? `:${code(r)}` : ""}`).sort();
      expect({ round: i, got }).toEqual({ round: i, got: ["200", "409:REVIEW_TASK_CLOSED"] });
      const runs = await waitFor(
        () => stageHubRuns(c.sql, g.runId),
        (xs) => xs.length >= 1,
        5_000,
      );
      const s1 = await stageRow(c.sql, g.runId, 1);
      expect({ round: i, stage2Runs: runs.filter((x) => x.stage_run_id === s1.id).length }).toEqual(
        {
          round: i,
          stage2Runs: 1,
        },
      );
      const [n] = await c.sql<
        { n: number }[]
      >`select count(*)::int as n from hub.process_thread_events
        where process_run_id = ${g.runId} and kind = 'task_result'`;
      expect(n?.n ?? 0).toBeLessThanOrEqual(1);
      await endHubRuns(c.sql, g.runId);
      await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now() where id = ${g.runId}`;
    }
  }, 120_000);
});

describe("P1-51 · task decision: assignee [readiness #2 · M5]", () => {
  it("HUB-FR-107 · P1-51 · `redo_limit` ⇒ assignee user A + group Kế toán, không tenant_admin; sự kiện thread `decision`", async () => {
    needSchema(c.ready);
    const g = await gateFix({ attempt: 4 });
    const r = await review(c, "B", g.taskId, { result: "fail", feedback: "Thiếu MST" });
    expect(r.status).toBe(200);
    await waitStatus(c.sql, g.runId, "needs_decision");
    const t = await openTask(c.sql, g.runId, "decision");
    expect(t).toBeDefined();
    const as = await c.sql<
      Json[]
    >`select user_id, group_id from hub.review_task_assignees where task_id = ${t?.id}
      order by user_id nulls last`;
    expect(as.map((a) => ({ user_id: a.user_id, group_id: a.group_id }))).toEqual([
      { user_id: PA.A.id, group_id: null },
      { user_id: null, group_id: PA_FIX.gKeToan },
    ]);
    expect(as.some((a) => a.user_id === PA.Adm.id)).toBe(false);
    const ev = await c.sql<Json[]>`select meta from hub.process_thread_events
      where process_run_id = ${g.runId} and kind = 'decision'`;
    expect(ev).toHaveLength(1);
    expect(ev[0]?.meta).toMatchObject({
      kind: "decision",
      task_id: t?.id,
      reason: "redo_limit",
      options: OPTS3,
    });
  }, 30_000);

  it("HUB-FR-107 · P1-51 · `team_calls` ⇒ task decision chỉ gán A (không group, không tenant_admin)", async () => {
    needSchema(c.ready);
    // qc-team: giới hạn 1 lần gọi ⇒ sau thành viên 1, lần gọi 2 không phát ⇒ needs_decision team_calls.
    const lim = {
      max_calls: 1,
      max_tokens: 200000,
      max_active_s: 600,
      summary_tokens: 200,
      max_plan_steps: 5,
    };
    await c.sql`update hub.agent_teams set limits = ${c.sql.json(lim)} where id = ${P1.teamQc}`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    try {
      const s = await startInRoom(c, { key: "p-team" });
      const job = await nextStageJob(c, s.runId);
      await jobDone(c, job, "## Phần A\nNội dung A.");
      const run = await waitStatus(c.sql, s.runId, "needs_decision", 10_000);
      expect(run.decision?.reason).toBe("team_calls");
      const t = await openTask(c.sql, s.runId, "decision");
      const as = await c.sql<
        Json[]
      >`select user_id, group_id from hub.review_task_assignees where task_id = ${t?.id}`;
      expect(as.map((a) => ({ user_id: a.user_id, group_id: a.group_id }))).toEqual([
        { user_id: PA.A.id, group_id: null },
      ]);
      await endHubRuns(c.sql, s.runId);
    } finally {
      await c.sql`update hub.agent_teams set limits = ${c.sql.json({ ...lim, max_calls: 10 })} where id = ${P1.teamQc}`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    }
  }, 40_000);
});
