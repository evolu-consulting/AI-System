// AC-H39 · PD-R08 · Q1 · PD-I10…PD-I15 (test-plan-int §2, plan §4.3, plan-addendum A5): thành viên nhóm lỗi tạm ⇒ stage
// `waiting_timer`, `team_runs` giữ `running` + cursor, đồng hồ hoạt động dừng; bắn ⇒ chạy lại từ thành viên lỗi, lượt gọi
// lại không đếm `calls`; cạn lượt ⇒ `retry_exhausted`; lỗi nghiệp vụ ⇒ quyết ngay. Def PF1 `p-team`/`p-lead`/`p-pm` đã seed.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  DEFS,
  decisionOf,
  type Job,
  type Json,
  jobDone,
  jobsOfRun,
  needPdSchema,
  nextStageJob,
  noStageJob,
  P1,
  SEC,
  stageOf,
  startPd,
  startRun,
  sweepN,
  waitStatus,
} from "../_support/pd";
import { failJob, fireAndTake, fireOpen, retryTimers, settle, teamRunsOf } from "./_retry";

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

const SECTION: Record<string, string> = {
  [P1.agM1]: "Phần A",
  [P1.agM2]: "Phần B",
  [P1.agM3]: "Phần C",
};
const who = (j: Job) => j.payload.agent.id as string;
/** Thành viên trả đúng mục mình. */
const ownMd = (j: Job) => `## ${SECTION[who(j)]}\nNội dung ${who(j)}.`;
const PLAN = [
  { member: "m1", sections: ["Phần A"], instruction: "Viết phần A" },
  { member: "m2", sections: ["Phần B"], instruction: "Viết phần B" },
  { member: "m3", sections: ["Phần C"], instruction: "Viết phần C" },
];
const upstream = (j: Job) => () => c.rt.fail(j, "UPSTREAM_ERROR", "agent lỗi", null);

/** Nhận job kế của run, đòi đúng agent. */
async function take(runId: string, agentId: string): Promise<Job> {
  const j = await nextStageJob(c, runId);
  expect({ agent: who(j) }).toEqual({ agent: agentId });
  return j;
}
const team = async (runId: string): Promise<Json> => (await teamRunsOf(c.sql, runId))[0] as Json;

/** `p-team` (sequential m1/m2/m3): m1 xong, m2 lỗi tạm ⇒ stage `waiting_timer`. */
async function seqM2Fail(): Promise<{ runId: string; callsAtFail: number }> {
  const runId = await startRun(c, DEFS.team.key);
  const m1 = await take(runId, P1.agM1);
  await jobDone(c, m1, ownMd(m1));
  const m2 = await take(runId, P1.agM2);
  const f = await failJob(c, runId, 0, upstream(m2));
  expect(f.stage.status).toBe("waiting_timer");
  return { runId, callsAtFail: (await team(runId))?.calls };
}

describe("PD-I10…I12 · sequential `qc-team` [AC-H39 · PD-R08]", () => {
  it("AC-H39 · PD-I10 · m1 ok, m2 UPSTREAM_ERROR ⇒ waiting_timer; team_run running, cursor 1, segment NULL, calls giữ; active_ms không tăng; m3 chưa có job", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, DEFS.team.key);
    const m1 = await take(runId, P1.agM1);
    await jobDone(c, m1, ownMd(m1));
    const m2 = await take(runId, P1.agM2);
    const callsBefore = (await team(runId))?.calls;
    const f = await failJob(c, runId, 0, upstream(m2));
    expect(f.stage.status).toBe("waiting_timer");
    const tr = await team(runId);
    expect({
      status: tr?.status,
      cursor: tr?.cursor,
      seg: tr?.segment_started_at,
      calls: tr?.calls,
    }).toEqual({ status: "running", cursor: 1, seg: null, calls: callsBefore });
    const a1 = tr?.active_ms;
    c.clk.advance(20 * SEC);
    await sweepN(c); // chưa tới hạn 30 s ⇒ không bắn
    expect((await team(runId))?.active_ms).toBe(a1);
    expect(await noStageJob(c, runId)).toBe(true);
    expect(await jobsOfRun(c.sql, runId)).toHaveLength(2);
  }, 60_000);

  it("AC-H39 · PD-I11 · tiếp I10: bắn hẹn ⇒ job mới cho m2 (không m1), calls không tăng; m2, m3 ok ⇒ gate; retry_count stage 1", async () => {
    needPdSchema(c.pd);
    const s = await seqM2Fail();
    const m2 = await fireAndTake(c, s.runId);
    expect({ agent: who(m2) }).toEqual({ agent: P1.agM2 });
    expect((await team(s.runId))?.calls).toBe(s.callsAtFail);
    await jobDone(c, m2, ownMd(m2));
    const m3 = await take(s.runId, P1.agM3);
    await jobDone(c, m3, ownMd(m3));
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect((await stageOf(c.sql, s.runId, 0))?.retry_count).toBe(1);
    expect((await team(s.runId))?.calls).toBe(s.callsAtFail + 1);
    expect(await teamRunsOf(c.sql, s.runId)).toHaveLength(1);
  }, 60_000);

  it("AC-H39 · PD-I12 · m2 lỗi tạm × 4 ⇒ `retry_exhausted`; team_run `failed`; m3 không job", async () => {
    needPdSchema(c.pd);
    const s = await seqM2Fail();
    for (let i = 0; i < 3; i++) {
      const m2 = await fireAndTake(c, s.runId);
      expect({ i, agent: who(m2) }).toEqual({ i, agent: P1.agM2 });
      const f = await failJob(c, s.runId, 0, upstream(m2));
      if (i < 2) expect({ i, status: f.stage.status }).toEqual({ i, status: "waiting_timer" });
    }
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await decisionOf(c.sql, s.runId))?.reason).toBe("retry_exhausted");
    expect((await team(s.runId))?.status).toBe("failed");
    expect(await jobsOfRun(c.sql, s.runId)).toHaveLength(5); // m1 + m2 × 4
  }, 60_000);
});

describe("PD-I13…I15 · lead_plan, parallel_merge, lỗi nghiệp vụ [AC-H39 · PD-R08 · Q1]", () => {
  it("AC-H39 · PD-I13 · lead_plan: lead lỗi tạm ⇒ bắn gọi lại lead, không đếm calls; plan chạy đủ ⇒ gate", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, DEFS.lead.key);
    const lead = await take(runId, P1.agLead);
    const calls = (await team(runId))?.calls;
    const f = await failJob(c, runId, 0, upstream(lead));
    expect(f.stage.status).toBe("waiting_timer");
    const lead2 = await fireAndTake(c, runId);
    expect({ agent: who(lead2) }).toEqual({ agent: P1.agLead });
    expect((await team(runId))?.calls).toBe(calls);
    await jobDone(c, lead2, JSON.stringify(PLAN));
    for (const a of [P1.agM1, P1.agM2, P1.agM3]) {
      const j = await take(runId, a);
      await jobDone(c, j, ownMd(j));
    }
    await waitStatus(c.sql, runId, "waiting_review");
  }, 60_000);

  it("AC-H39 · PD-I13 · lead_plan biến thể: m2 lỗi tạm sau khi có plan ⇒ bắn chạy tiếp từ cursor theo plan đã lưu (m2, không lead/m1), calls không tăng", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, DEFS.lead.key);
    await jobDone(c, await take(runId, P1.agLead), JSON.stringify(PLAN));
    const m1 = await take(runId, P1.agM1);
    await jobDone(c, m1, ownMd(m1));
    const m2 = await take(runId, P1.agM2);
    const f = await failJob(c, runId, 0, upstream(m2));
    expect(f.stage.status).toBe("waiting_timer");
    const tr = await team(runId);
    expect({ plan: tr?.plan !== null, cursor: tr?.cursor, status: tr?.status }).toEqual({
      plan: true,
      cursor: 1,
      status: "running",
    });
    const again = await fireAndTake(c, runId);
    expect({ agent: who(again) }).toEqual({ agent: P1.agM2 });
    expect((await team(runId))?.calls).toBe(tr?.calls);
    await jobDone(c, again, ownMd(again));
    const m3 = await take(runId, P1.agM3);
    await jobDone(c, m3, ownMd(m3));
    await waitStatus(c.sql, runId, "waiting_review");
  }, 60_000);

  it("AC-H39 · PD-I14 · parallel_merge: m2 lỗi tạm ⇒ bắn gọi lại MỌI thành viên của lượt (m1, m2); lượt gọi lại không đếm calls ⇒ gate", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, DEFS.pm.key);
    const js = [await nextStageJob(c, runId), await nextStageJob(c, runId)];
    expect(js.map(who).sort()).toEqual([P1.agM1, P1.agM2].sort());
    const m1 = js.find((j) => who(j) === P1.agM1) as Job;
    const m2 = js.find((j) => who(j) === P1.agM2) as Job;
    await jobDone(c, m1, ownMd(m1));
    const f = await failJob(c, runId, 0, upstream(m2));
    expect(f.stage.status).toBe("waiting_timer");
    const calls = (await team(runId))?.calls;
    await fireOpen(c, runId);
    const again = [await nextStageJob(c, runId), await nextStageJob(c, runId)];
    expect(again.map(who).sort()).toEqual([P1.agM1, P1.agM2].sort());
    expect((await team(runId))?.calls).toBe(calls);
    for (const j of again) await jobDone(c, j, ownMd(j));
    await waitStatus(c.sql, runId, "waiting_review");
  }, 60_000);

  it("AC-H39 · PD-I15 · m2 NOT_CONFIGURED + credential ⇒ needs_decision ngay (TM-08), retry_count 0, 0 hẹn retry", async () => {
    needPdSchema(c.pd);
    const runId = await startRun(c, DEFS.team.key);
    const m1 = await take(runId, P1.agM1);
    await jobDone(c, m1, ownMd(m1));
    const m2 = await take(runId, P1.agM2);
    await failJob(c, runId, 0, () =>
      c.rt.fail(m2, "NOT_CONFIGURED", "agent chưa cấu hình", "credential"),
    );
    await waitStatus(c.sql, runId, "needs_decision");
    expect((await stageOf(c.sql, runId, 0))?.retry_count).toBe(0);
    expect(await retryTimers(c.sql, runId)).toHaveLength(0);
    expect(await decisionOf(c.sql, runId)).toBeDefined();
  }, 60_000);
});
