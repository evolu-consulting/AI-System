// AC-H46 · HUB-FR-144/145 · S1/S2 · K3/K7 · test-plan-int §6 (PD-I60…PD-I66): cách ly tenant ở vòng hẹn giờ/nhắc/chuyển cấp
// (hai tenant đối xứng, MỘT lượt chung — khuôn regression `scanDue` P-c2 D1), RLS `hub_rw` + FK kép + GRANT `process_timers`.
// Fixture 0036 chỉ chèn sau `needPdSchema` ⇒ trước code mọi ca đỏ ở đó. PD-I67 ở `editor-context.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { AGENT_RT_URL, HUB_API_URL } from "../../H1/_fixtures";
import { asUser, pgCode } from "../../X2a/_x2a";
import {
  type CtxPd,
  DAY,
  G1,
  HOUR,
  handles,
  type Json,
  needPdSchema,
  PA,
  PD,
  remind,
  type Sql,
  secondHub,
  startPd,
  sweepN,
  T,
  waitFor,
  waitStageStatus,
} from "../_support/pd";
import {
  insertTimer,
  quiesceDue,
  reviewRun,
  type Side,
  seedTwoTenant,
  sideState,
  tenantMismatches,
} from "../_support/two-tenant";

let c: CtxPd;
let db: Sql;
let rt: Sql;
beforeAll(async () => {
  c = await startPd();
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
  rt = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await rt?.end();
  await db?.end();
  await c?.stop();
});

const ZERO = {
  timers_run: 0,
  timers_stage: 0,
  stages: 0,
  outputs: 0,
  hub_runs: 0,
  tasks: 0,
  assignees: 0,
  notices: 0,
};
const sorted = (a: string[]) => [...a].sort();
const timerIds = (s: Side) => [s.retry.timerId, s.wait.timerId];

/** `{tenant_id: số hẹn đã bắn}` trong tập id. */
async function firedByTenant(ids: string[]): Promise<Record<string, number>> {
  const rows = await c.sql<{ t: string; n: number }[]>`select tenant_id as t, count(*)::int as n
    from hub.process_timers where id = any(${c.sql.array(ids, 2950)}) and fired_at is not null group by 1`;
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}
/** Tenant của mọi `hub.runs` (job) của process run, chờ có ít nhất 1. */
async function hubRunTenants(runId: string): Promise<string[]> {
  const q = () =>
    c.sql<{ t: string }[]>`select tenant_id as t from hub.runs where process_run_id = ${runId}`;
  const rows = await waitFor(q, (v) => v.length > 0, 8_000);
  return rows.map((r) => r.t);
}
const noticesOf = (runId: string, kind: string) =>
  c.sql<{ user_id: string; tenant_id: string }[]>`select user_id, tenant_id from hub.process_notices
    where process_run_id = ${runId} and kind = ${kind}`;

/** Mỗi hiệu ứng của một phía thuộc đúng tenant phía đó (PD-I60). */
async function expectSideApplied(s: Side): Promise<void> {
  const tag = { tid: s.tid };
  expect({ ...tag, jobs: [...new Set(await hubRunTenants(s.retry.runId))] }).toEqual({
    ...tag,
    jobs: [s.tid],
  });
  await waitStageStatus(c, s.wait.runId, 0, "done");
  const outs = await c.sql<Json[]>`select tenant_id from hub.process_outputs
    where process_run_id = ${s.wait.runId} and stage_idx = 0`;
  expect({ ...tag, outs: outs.map((o) => o.tenant_id) }).toEqual({ ...tag, outs: [s.tid] });
  const [rt0] = await c.sql<
    Json[]
  >`select remind_count from hub.review_tasks where id = ${s.remindTask.taskId}`;
  expect({ ...tag, remind_count: rt0?.remind_count }).toEqual({ ...tag, remind_count: 2 });
  const rem = await noticesOf(s.remindTask.runId, "reminder");
  expect({
    ...tag,
    users: sorted(rem.map((n) => n.user_id)),
    t: [...new Set(rem.map((n) => n.tenant_id))],
  }).toEqual({ ...tag, users: sorted(s.reviewers), t: [s.tid] });
  const asg = await c.sql<Json[]>`select group_id, tenant_id from hub.review_task_assignees
    where task_id = ${s.escTask.taskId} and via = 'escalated'`;
  expect({ ...tag, asg: [...asg] }).toEqual({
    ...tag,
    asg: [{ group_id: s.escGroup, tenant_id: s.tid }],
  });
  const esc = await noticesOf(s.escTask.runId, "escalated");
  expect({
    ...tag,
    users: sorted(esc.map((n) => n.user_id)),
    t: [...new Set(esc.map((n) => n.tenant_id))],
  }).toEqual({ ...tag, users: sorted(s.escalatees), t: [s.tid] });
  const aud = await c.sql<Json[]>`select tenant_id from hub.audit_log
    where entity_id = ${s.escTask.taskId} and action = 'escalate'`;
  expect({ ...tag, audit: aud.map((a) => a.tenant_id) }).toEqual({ ...tag, audit: [s.tid] });
}

describe("AC-H46 · vòng nền hai tenant (K3)", () => {
  it("AC-H46 · PD-I60 · 8 hàng hai tenant cùng tới hạn ⇒ 1 sweep + 1 remind: mỗi hiệu ứng đúng tenant hàng, timers=4, 0 hàng lệch tenant", async () => {
    needPdSchema(c.pd);
    await quiesceDue(c);
    const s = await seedTwoTenant(c);
    const r = await sweepN(c, 1);
    expect({ timers: r?.timers }).toEqual({ timers: 4 });
    await remind(c);
    expect(await firedByTenant([...timerIds(s.acme), ...timerIds(s.beta)])).toEqual({
      [T.acme]: 2,
      [T.beta]: 2,
    });
    await expectSideApplied(s.acme);
    await expectSideApplied(s.beta);
    expect(await tenantMismatches(c.sql)).toEqual(ZERO);
  }, 60_000);

  it("AC-H46 · PD-I61 · chỉ beta tới hạn (acme +1 h) ⇒ acme 0 thay đổi (updated_at, fired_at, notice, nhắc, chuyển cấp)", async () => {
    needPdSchema(c.pd);
    await quiesceDue(c);
    const s = await seedTwoTenant(c, { acmeDue: new Date(c.clk.now().getTime() + HOUR) });
    const before = await sideState(c.sql, s.acme);
    await sweepN(c, 1);
    await remind(c);
    expect(await firedByTenant(timerIds(s.beta))).toEqual({ [T.beta]: 2 });
    expect(await sideState(c.sql, s.acme)).toEqual(before);
  }, 60_000);

  it("AC-H46 · PD-I62 · hẹn acme + beta cùng due_at, sweep song song 2 Hub ⇒ mỗi hẹn bắn 1 lần, đúng tenant", async () => {
    needPdSchema(c.pd);
    await quiesceDue(c);
    const s = await seedTwoTenant(c);
    const h2 = await secondHub(c, { now: c.clk.now });
    try {
      await Promise.all([handles(c).sweepOnce(), handles({ ...c, hub: h2 }).sweepOnce()]);
      expect(await firedByTenant([...timerIds(s.acme), ...timerIds(s.beta)])).toEqual({
        [T.acme]: 2,
        [T.beta]: 2,
      });
      for (const side of [s.acme, s.beta]) {
        expect(await hubRunTenants(side.retry.runId)).toEqual([side.tid]);
        const more = await hubRunTenants(side.retry.runId); // sweep đã await ⇒ đo một lần (không ngủ chờ job thừa)
        expect({ tid: side.tid, jobs: more.length }).toEqual({ tid: side.tid, jobs: 1 });
        await waitStageStatus(c, side.wait.runId, 0, "done", 0);
        const [o] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_outputs
          where process_run_id = ${side.wait.runId} and stage_idx = 0`;
        expect({ tid: side.tid, outputs: o?.n }).toEqual({ tid: side.tid, outputs: 1 });
      }
    } finally {
      await h2.stop();
    }
  }, 60_000);

  it("AC-H46 · S2 · PD-I63 · task acme có escalate_group_id = Group beta ⇒ remind: không assignee, audit escalate_skipped", async () => {
    needPdSchema(c.pd);
    await quiesceDue(c);
    const t = await reviewRun(c, T.acme, PA.A, G1);
    await c.sql`update hub.review_tasks set escalate_at = ${new Date(c.clk.now().getTime() - 60_000)},
      escalate_group_id = ${PD.gBetaKT}, remind_at = ${new Date(c.clk.now().getTime() + DAY)} where id = ${t.taskId}`;
    await remind(c);
    const [asg] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.review_task_assignees
      where task_id = ${t.taskId} and via = 'escalated'`;
    expect({ escalatedAssignees: asg?.n }).toEqual({ escalatedAssignees: 0 });
    expect((await noticesOf(t.runId, "escalated")).length).toBe(0);
    const aud = await c.sql<Json[]>`select action, tenant_id, entity from hub.audit_log
      where entity_id = ${t.taskId} and action in ('escalate', 'escalate_skipped')`;
    expect([...aud]).toEqual([
      { action: "escalate_skipped", tenant_id: T.acme, entity: "review_task" },
    ]);
  }, 60_000);
});

describe("AC-H46 · RLS + FK kép + GRANT process_timers (K7)", () => {
  /** Hai tenant có hẹn (tới hạn xa, không bị vòng nền chạm). */
  const seedFar = async () => {
    await quiesceDue(c);
    const far = new Date(c.clk.now().getTime() + 3 * DAY);
    return seedTwoTenant(c, { acmeDue: far, betaDue: far });
  };

  it("AC-H46 · PD-I64 · hub_rw scope user an (beta): SELECT 0 hàng acme; UPDATE acme 0 hàng; INSERT acme ⇒ 42501; DELETE ⇒ 42501", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const seen = await asUser(
      db,
      PA.D,
      (tx) => tx<{ t: string }[]>`select tenant_id as t from hub.process_timers`,
    );
    expect({ acmeRows: seen.filter((r) => r.t === T.acme).length }).toEqual({ acmeRows: 0 });
    const upd = await asUser(
      db,
      PA.D,
      async (tx) =>
        (await tx`update hub.process_timers set due_at = due_at where tenant_id = ${T.acme}`).count,
    );
    expect({ updated: upd }).toEqual({ updated: 0 });
    const ins = await pgCode(
      asUser(db, PA.D, (tx) =>
        insertTimer(tx as unknown as Sql, {
          tid: T.acme,
          runId: s.acme.retry.runId,
          stageRunId: s.acme.retry.stageRunId,
          kind: "retry",
          dueAt: new Date(c.clk.now().getTime() + DAY),
          key: `retry:${s.acme.retry.stageRunId}:1:1:9`,
        }),
      ),
    );
    expect({ insertAcme: ins }).toEqual({ insertAcme: "42501" });
    const del = await pgCode(
      asUser(
        db,
        PA.D,
        (tx) => tx`delete from hub.process_timers where id = ${s.beta.retry.timerId}`,
      ),
    );
    expect({ delete: del }).toEqual({ delete: "42501" });
  }, 60_000);

  it("AC-H46 · PD-I65 · owner chèn hẹn tenant beta với stage_run_id/process_run_id của acme ⇒ 23503 (FK kép)", async () => {
    needPdSchema(c.pd);
    const s = await seedFar();
    const code = await pgCode(
      insertTimer(c.sql, {
        tid: T.beta,
        runId: s.acme.wait.runId,
        stageRunId: s.acme.wait.stageRunId,
        kind: "retry",
        dueAt: new Date(c.clk.now().getTime() + DAY),
        key: `retry:${s.acme.wait.stageRunId}:9:9:9`,
      }),
    );
    expect({ fk: code }).toEqual({ fk: "23503" });
    const stageOnly = await pgCode(
      insertTimer(c.sql, {
        tid: T.beta,
        runId: s.beta.retry.runId,
        stageRunId: s.acme.retry.stageRunId,
        kind: "retry",
        dueAt: new Date(c.clk.now().getTime() + DAY),
        key: `retry:${s.acme.retry.stageRunId}:9:9:8`,
      }),
    );
    expect({ fkStage: stageOnly }).toEqual({ fkStage: "23503" });
  }, 60_000);

  it("AC-H46 · PD-I66 · role agent_runtime SELECT hub.process_timers ⇒ 42501", async () => {
    needPdSchema(c.pd);
    expect({ agentRuntime: await pgCode(rt`select count(*) from hub.process_timers`) }).toEqual({
      agentRuntime: "42501",
    });
  });
});
