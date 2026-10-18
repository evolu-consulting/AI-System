// AC-PB-03 · PB-R17 · PB-R18 · TECH-DEBT #133/#134 · TM-01…TM-15 (test-plan P-b §4.4): stage nhóm ≥ 2 thành viên.
// #133: thành viên sau tải được file chung (output stage trước + nháp ghép của thành viên trước) = 200.
// #134: job thành viên fail ⇒ `hub.runs.error_code` ∈ 7 mã `runs_error_code_ck`, process run `needs_decision`, không kẹt `running`.
// Runtime giả `ScriptRuntime` tự gọi `GET /internal/jobs/:id/attachments/:attId` bằng token job (đặt như lúc claim).
// Trước code: TM-01…05 đỏ ở expect (nháp thành viên trước 401); TM-06…14 đỏ ở expect (run kẹt `running`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../../P-a/_support/schema";
import {
  badRuns,
  type Ctx4,
  D4,
  ERROR_CODES_7,
  hubRunOf,
  type Job,
  type Json,
  jobDone,
  memberKey,
  names,
  outputs,
  ownMd,
  P1,
  type Probe,
  probeJob,
  rejections,
  runRow,
  SINGLE_DEF,
  serve,
  serveAll,
  settleAll,
  sha256,
  stageHubRuns,
  startInRoom,
  startPfs4,
  stuckRunning,
  T,
  waitFor,
  waitStatus,
} from "./_local";

let c: Ctx4;
beforeAll(async () => {
  c = await startPfs4();
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settleAll(c.sql);
});
afterAll(async () => {
  await c?.stop();
});

type Seen = Map<string, Probe[]>; // memberKey → probe của job
/** Phục vụ run tới khi rời `running`; mọi job thành viên tải hết file như Runtime thật rồi trả mục của mình. */
async function runTeam(
  key: string,
  onJob?: (j: Job) => Promise<boolean>, // true = đã xử lý (fail…)
): Promise<{ runId: string; jobs: Job[]; seen: Seen }> {
  const s = await startInRoom(c, { key });
  const seen: Seen = new Map();
  const jobs = await serveAll(c, s.runId, async (j) => {
    seen.set(memberKey(j), await probeJob(c, j));
    if (onJob && (await onJob(j))) return;
    await jobDone(c, j, ownMd(j));
  });
  return { runId: s.runId, jobs, seen };
}
const bad = (ps: Probe[]) => ps.filter((p) => p.status !== 200).map((p) => `${p.name}:${p.status}`);
const draftOf = (ps: Probe[]) => ps.filter((p) => /^s1-v\d+-/.test(p.name));
const decisionOf = async (runId: string): Promise<Json> => (await runRow(c.sql, runId))?.decision;
const failOnly = (agentId: string, how: (j: Job) => Promise<void>) => async (j: Job) => {
  if (j.payload.agent.id !== agentId) return false;
  await how(j);
  return true;
};
const upstream = (j: Job) => c.rt.fail(j, "UPSTREAM_ERROR", "agent lỗi");
const timeout = (j: Job) => c.rt.fail(j, "TIMEOUT", "quá hạn", null, "timed_out");
const notConfigured = (j: Job) =>
  c.rt.fail(j, "NOT_CONFIGURED", "agent chưa cấu hình", "credential");

describe("TM-01…05 · #133 thành viên sau tải được file chung [AC-PB-03, PB-R18]", () => {
  it("AC-PB-03 · TM-01 · #133 sequential m1,m2,m3: mọi file (O0 + nháp) tải 200; m2+ có nháp chứa mục thành viên trước; run waiting_review", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.seq.key);
    expect([...r.seen.keys()]).toEqual(["m1", "m2", "m3"]);
    for (const [k, ps] of r.seen) {
      expect({ k, bad: bad(ps) }).toEqual({ k, bad: [] });
      expect(names(ps).some((n) => n.startsWith("s0-v1-"))).toBe(true); // O0
      expect(draftOf(ps).length).toBeGreaterThanOrEqual(1); // nháp ghép
    }
    const m2 = draftOf(r.seen.get("m2") ?? [])
      .map((p) => p.text)
      .join("\n");
    expect(m2).toContain("Nội dung m1 v1");
    const m3 = draftOf(r.seen.get("m3") ?? [])
      .map((p) => p.text)
      .join("\n");
    expect(m3).toContain("Nội dung m1 v1");
    expect(m3).toContain("Nội dung m2 v1");
    await waitStatus(c.sql, r.runId, "waiting_review");
  }, 40_000);

  it("AC-PB-03 · TM-02 · #133 parallel_merge m1,m2: cùng tải O0 = 200; có output gộp; waiting_review", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.pm.key);
    expect([...r.seen.keys()].sort()).toEqual(["m1", "m2"]);
    for (const [k, ps] of r.seen) {
      expect({ k, bad: bad(ps) }).toEqual({ k, bad: [] });
      expect(names(ps).some((n) => n.startsWith("s0-v1-"))).toBe(true);
    }
    await waitStatus(c.sql, r.runId, "waiting_review");
    const out = (await outputs(c.sql, r.runId)).find((o) => o.stage_idx === 1);
    expect(out?.content).toContain("Nội dung m1 v1");
    expect(out?.content).toContain("Nội dung m2 v1");
  }, 40_000);

  it("PB-R18 · TM-03 · #133 payload.attachments của m2 = id O0 + id nháp; mỗi id là hàng thật hub.attachments (tenant acme, gắn run)", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.seq.key);
    await waitStatus(c.sql, r.runId, "waiting_review");
    const o0 = (await outputs(c.sql, r.runId)).find((o) => o.stage_idx === 0);
    const m2 = r.seen.get("m2") ?? [];
    const ids = m2.map((p) => p.id);
    expect(ids).toContain(o0?.attachment_id);
    const drafts = draftOf(m2);
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    for (const p of m2) {
      const [row] = await c.sql<Json[]>`select a.tenant_id, a.origin, r.process_run_id
        from hub.attachments a left join hub.jobs j on j.id = a.job_id left join hub.runs r on r.id = j.run_id
        where a.id = ${p.id}`;
      expect({ name: p.name, row: row !== undefined }).toEqual({ name: p.name, row: true });
      expect(row?.tenant_id).toBe(T.acme);
      expect(row?.process_run_id).toBe(r.runId);
    }
  }, 40_000);

  it("AC-PB-03 · TM-04 · #133 nội dung nháp m1 tải được có sha256 = nội dung m1 đã phát (header = payload = băm thân)", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.seq.key);
    const d = draftOf(r.seen.get("m2") ?? []).find((p) => p.text.includes("Nội dung m1 v1"));
    expect(d).toBeDefined();
    expect(d?.status).toBe(200);
    expect(sha256(d?.text ?? "")).toBe(d?.payloadSha ?? "");
    expect(d?.headerSha ?? "").toBe(d?.payloadSha ?? "");
  }, 40_000);

  it("AC-PB-03 · TM-05 · #133 lead-team (lead_plan): mọi job (kế hoạch + thành viên) tải file 200; thành viên sau thấy mục trước", async () => {
    needSchema(c.ready);
    const plan = [
      { member: "m1", sections: ["Phần A"], instruction: "Viết phần A" },
      { member: "m3", sections: ["Phần C"], instruction: "Viết phần C" },
    ];
    const s = await startInRoom(c, { key: D4.lead.key });
    const seen: Seen = new Map();
    await serveAll(c, s.runId, async (j) => {
      const isLead = j.payload.agent.id === P1.agLead;
      seen.set(isLead ? "lead" : memberKey(j), await probeJob(c, j));
      await jobDone(c, j, isLead ? JSON.stringify(plan) : ownMd(j));
    });
    expect([...seen.keys()]).toEqual(["lead", "m1", "m3"]);
    for (const [k, ps] of seen) expect({ k, bad: bad(ps) }).toEqual({ k, bad: [] });
    expect(
      draftOf(seen.get("m3") ?? [])
        .map((p) => p.text)
        .join("\n"),
    ).toContain("Nội dung m1 v1");
    await waitStatus(c.sql, s.runId, "waiting_review");
  }, 40_000);
});

describe("TM-06…09 · #134 job thành viên fail ⇒ mã lỗi hợp lệ, needs_decision, không kẹt [PB-R17, AC-PB-03]", () => {
  /** m2 (hoặc m1) fail bằng `how`; trả run id process + hub run id của job fail. */
  async function failCase(agentId: string, how: (j: Job) => Promise<void>) {
    const failedRun: { id?: string } = {};
    const r = await runTeam(
      D4.seq.key,
      failOnly(agentId, async (j) => {
        failedRun.id = j.runId;
        await how(j);
      }),
    );
    return { ...r, failedRunId: failedRun.id as string };
  }
  async function expectRunFailed(runId: string, hubRunId: string, code: string) {
    expect(await stuckRunning(c.sql, runId)).toBe(0);
    await waitStatus(c.sql, runId, "needs_decision", 10_000);
    const hr = await hubRunOf(c.sql, hubRunId);
    expect({ status: hr?.status, code: hr?.error_code }).toEqual({ status: "failed", code });
    expect(String(hr?.error_message ?? "").length).toBeGreaterThan(0);
    expect(String(hr?.error_hint ?? "").length).toBeGreaterThan(0);
    expect(ERROR_CODES_7).toContain(hr?.error_code);
  }

  it("PB-R17 · TM-06 · #134 m2 fail UPSTREAM_ERROR ⇒ hub.runs m2 failed/UPSTREAM_ERROR + message/hint; needs_decision; không còn running; m3 không khởi động", async () => {
    needSchema(c.ready);
    const r = await failCase(P1.agM2, upstream);
    await expectRunFailed(r.runId, r.failedRunId, "UPSTREAM_ERROR");
    expect(r.jobs.map(memberKey).filter((k) => k !== "hd-read")).not.toContain("m3");
    const [st] = await c.sql<Json[]>`select status from hub.stage_runs
      where process_run_id = ${r.runId} and stage_idx = 1`;
    expect(["failed", "needs_decision"]).toContain(st?.status);
    expect(["agent_failed", "job_timeout"]).toContain((await decisionOf(r.runId))?.reason);
  }, 40_000);

  it("PB-R17 · TM-07 · #134 m2 quá hạn (job TIMEOUT) ⇒ hub.runs m2 error_code TIMEOUT, needs_decision job_timeout", async () => {
    needSchema(c.ready);
    const r = await failCase(P1.agM2, timeout);
    await expectRunFailed(r.runId, r.failedRunId, "TIMEOUT");
    expect((await decisionOf(r.runId))?.reason).toBe("job_timeout");
  }, 40_000);

  it("PB-R17 · TM-08 · #134 m2 báo NOT_CONFIGURED (agent chưa cấu hình) ⇒ hub.runs m2 error_code NOT_CONFIGURED, needs_decision", async () => {
    needSchema(c.ready);
    const r = await failCase(P1.agM2, notConfigured);
    await expectRunFailed(r.runId, r.failedRunId, "NOT_CONFIGURED");
  }, 40_000);

  it("PB-R17 · TM-09 · #134 m1 (thành viên đầu) fail ⇒ như TM-06; m2, m3 không khởi động", async () => {
    needSchema(c.ready);
    const r = await failCase(P1.agM1, upstream);
    await expectRunFailed(r.runId, r.failedRunId, "UPSTREAM_ERROR");
    const keys = r.jobs.map((j) => j.payload.agent.id);
    expect(keys).not.toContain(P1.agM2);
    expect(keys).not.toContain(P1.agM3);
  }, 40_000);
});

describe("TM-10…15 · #134 bất biến, handler không ném, retry/cancel, hồi quy [PB-R17]", () => {
  it("PB-R17 · TM-10 · #134 sau ca fail: không hub.runs nào vi phạm (error_code ↔ status failed/cancelled) và mọi error_code ∈ 7 mã", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.seq.key, failOnly(P1.agM2, upstream));
    expect(await stuckRunning(c.sql, r.runId)).toBe(0);
    expect(await badRuns(c.sql)).toBe(0);
    const runs = await stageHubRuns(c.sql, r.runId);
    for (const h of runs) {
      if (h.status === "failed") expect(ERROR_CODES_7).toContain(h.error_code);
      else expect(h.error_code).toBeNull();
    }
    expect(runs.filter((h) => h.status === "failed").length).toBeGreaterThanOrEqual(1);
  }, 40_000);

  it("PB-R17 · TM-11 · #134 handler không ném (không unhandledRejection) và run khác sau đó chạy tới waiting_review", async () => {
    needSchema(c.ready);
    const before = rejections.length;
    const r = await runTeam(D4.seq.key, failOnly(P1.agM2, upstream));
    expect(await stuckRunning(c.sql, r.runId)).toBe(0);
    await waitStatus(c.sql, r.runId, "needs_decision", 10_000);
    await c.call("A", "POST", `/process-runs/${r.runId}/cancel`, {});
    const next = await runTeam(D4.seq.key);
    await waitStatus(c.sql, next.runId, "waiting_review");
    expect(rejections.slice(before)).toEqual([]);
  }, 60_000);

  it("PB-R17 · TM-12 · #134 parallel_merge m1 ok, m2 fail ⇒ stage needs_decision, output m1 chưa công bố (không process_outputs stage 1)", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.pm.key, failOnly(P1.agM2, upstream));
    expect(await stuckRunning(c.sql, r.runId)).toBe(0);
    await waitStatus(c.sql, r.runId, "needs_decision", 10_000);
    expect((await outputs(c.sql, r.runId)).filter((o) => o.stage_idx === 1)).toHaveLength(0);
    expect(await badRuns(c.sql)).toBe(0);
  }, 40_000);

  it("PB-R17 · TM-13 · #134 sau fail, decide add_attempt (runtime nay ok) ⇒ chạy lại stage nhóm tới waiting_review", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.seq.key, failOnly(P1.agM2, upstream));
    await waitStatus(c.sql, r.runId, "needs_decision", 10_000);
    const d = await c.call("A", "POST", `/process-runs/${r.runId}/decide`, {
      option: "add_attempt",
    });
    expect(d.status).toBe(200);
    await serveAll(c, r.runId, async (j) => {
      await probeJob(c, j);
      await jobDone(c, j, ownMd(j));
    });
    await waitStatus(c.sql, r.runId, "waiting_review");
  }, 60_000);

  it("PB-R17 · TM-14 · #134 sau fail, decide cancel ⇒ process run cancelled; bất biến mã lỗi giữ", async () => {
    needSchema(c.ready);
    const r = await runTeam(D4.seq.key, failOnly(P1.agM2, upstream));
    await waitStatus(c.sql, r.runId, "needs_decision", 10_000);
    const d = await c.call("A", "POST", `/process-runs/${r.runId}/decide`, { option: "cancel" });
    expect(d.status).toBe(200);
    await waitStatus(c.sql, r.runId, "cancelled");
    expect(await badRuns(c.sql)).toBe(0);
  }, 40_000);

  it("PB-R17 · TM-15 · hồi quy: stage agent đơn fail UPSTREAM_ERROR ⇒ needs_decision agent_failed + hub.runs mã hợp lệ", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: SINGLE_DEF.key });
    const jobs = await serve(c, s.runId, async (j) => {
      await c.rt.fail(j, "UPSTREAM_ERROR", "agent lỗi", "refused");
    });
    await waitStatus(c.sql, s.runId, "needs_decision", 10_000);
    expect((await decisionOf(s.runId))?.reason).toBe("agent_failed");
    const hr = await waitFor(
      () => hubRunOf(c.sql, jobs[0]?.runId as string),
      (v) => v?.status === "failed",
      5_000,
    );
    expect(ERROR_CODES_7).toContain(hr?.error_code);
    expect(await badRuns(c.sql)).toBe(0);
  }, 40_000);
});
