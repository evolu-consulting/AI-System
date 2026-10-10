// HUB-FR-117 · AC-H34 · C5 · Q4 · R-U01…R-U04 — `buildUsage` (usage/usage.rules.ts, plan-contract §2 `ProcessRunUsage`, §7).
// `StageMeta` chưa khai báo ở plan-contract §7 ⇒ qc giả định `{stageIdx, name, attempts, asksCount, teamRuns[{id, attempt, mode,
// status, stopReason, activeMs}]}` (ghi "Cần bổ sung" cho backend-lead ở test-plan-int phụ lục). Đỏ trước code ở `fn()`.
import { describe, expect, it } from "bun:test";
import { fn, loadProcRules } from "../../_support/modules";

// biome-ignore lint/suspicious/noExplicitAny: object thử theo contract
type Json = any;
const u = (n: number) => `a5a00000-0000-4000-8000-${String(30_000 + n).padStart(12, "0")}`;
const RUN0A = u(1);
const RUN0B = u(2);
const RUN1 = u(3);
const SR0 = u(10);
const SR1 = u(11);
const TR = u(20);
const AT = new Date("2026-10-10T01:00:00Z");
let step = 100;
const row = (o: Partial<Json>): Json => ({
  runId: RUN0A,
  stageRunId: SR0,
  stageIdx: 0,
  teamRunId: null,
  stepId: u(step++),
  role: "agent",
  memberKey: null,
  agentKey: "hoadon",
  model: "claude-sonnet",
  input: 100,
  output: 50,
  cacheRead: null,
  cacheWrite: null,
  latencyMs: 1200,
  at: AT,
  ...o,
});
const ROWS: Json[] = [
  row({ runId: RUN0A, input: 1000, output: 200, cacheRead: 300, cacheWrite: 10 }),
  row({ runId: RUN0B, input: 900, output: 100 }),
  row({
    runId: RUN1,
    stageRunId: SR1,
    stageIdx: 1,
    teamRunId: TR,
    role: "plan",
    agentKey: "lead",
    input: 50,
    output: 20,
  }),
  ...["m1", "m2", "m3"].map((m, i) =>
    row({
      runId: RUN1,
      stageRunId: SR1,
      stageIdx: 1,
      teamRunId: TR,
      role: "member",
      memberKey: m,
      agentKey: m,
      input: 10 * (i + 1),
      output: 5,
      cacheWrite: 1,
    }),
  ),
];
const STAGES: Json[] = [
  { stageIdx: 0, name: "Đọc hoá đơn", attempts: 2, asksCount: 0, teamRuns: [] },
  {
    stageIdx: 1,
    name: "Nhóm viết",
    attempts: 1,
    asksCount: 1,
    teamRuns: [
      { id: TR, attempt: 1, mode: "sequential", status: "done", stopReason: null, activeMs: 4200 },
    ],
  },
];
const sum = (rs: Json[]) =>
  rs.reduce((a, r) => a + r.input + r.output + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0), 0);
const load = async () => fn(await loadProcRules("usage/usage.rules.ts"), "buildUsage");

describe("buildUsage [HUB-FR-117]", () => {
  it("AC-H34 · R-U01 · full: totals = Σ(in+out+cr+cw), calls = số dòng; stage 0 attempts 2; stage 1 team_runs[0].calls 4 (plan + 3 member, member_key)", async () => {
    const b = await load();
    const r = b(ROWS, STAGES, "full");
    expect(r.detail).toBe("full");
    expect(r.totals.total).toBe(sum(ROWS));
    expect(r.totals.calls).toBe(ROWS.length);
    expect(r.totals.input).toBe(ROWS.reduce((a, x) => a + x.input, 0));
    expect(r.totals.cache_read).toBe(300);
    const [s0, s1] = r.stages;
    expect(s0).toMatchObject({ stage_idx: 0, attempts: 2 });
    expect(s0.totals.total).toBe(sum(ROWS.slice(0, 2)));
    expect(s0.calls.length).toBe(2);
    expect(s1.team_runs.length).toBe(1);
    expect(s1.team_runs[0]).toMatchObject({ id: TR, mode: "sequential", active_ms: 4200 });
    const calls = s1.team_runs[0].calls;
    expect(calls.length).toBe(4);
    expect(calls.map((x: Json) => x.role).sort()).toEqual(["member", "member", "member", "plan"]);
    expect(
      calls
        .map((x: Json) => x.member_key)
        .filter(Boolean)
        .sort(),
    ).toEqual(["m1", "m2", "m3"]);
    for (const x of calls) expect(x.tokens.calls).toBe(1);
    expect(s1.totals.total).toBe(sum(ROWS.slice(2)));
  });
  it("C5 · R-U02 · summary: totals như full; mọi stage team_runs=[] và calls=[]", async () => {
    const b = await load();
    const full = b(ROWS, STAGES, "full");
    const s = b(ROWS, STAGES, "summary");
    expect(s.detail).toBe("summary");
    expect(s.totals).toEqual(full.totals);
    for (const st of s.stages)
      expect({ team_runs: st.team_runs, calls: st.calls }).toEqual({ team_runs: [], calls: [] });
  });
  it("HUB-FR-117 · R-U03 · stage không có dòng ⇒ totals 0; cache null tính 0", async () => {
    const b = await load();
    const r = b([row({ cacheRead: null, cacheWrite: null, input: 7, output: 3 })], STAGES, "full");
    expect(r.totals).toEqual({
      input: 7,
      output: 3,
      cache_read: 0,
      cache_write: 0,
      total: 10,
      calls: 1,
    });
    expect(r.stages[1].totals).toEqual({
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
      total: 0,
      calls: 0,
    });
  });
  it("AC-H34 · R-U04 · 60 lần gọi một stage ⇒ calls ≤ 50, totals đủ 60 (Q4)", async () => {
    const b = await load();
    const many = Array.from({ length: 60 }, () => row({ input: 10, output: 1 }));
    const r = b(many, STAGES, "full");
    expect(r.stages[0].calls.length).toBe(50);
    expect(r.stages[0].totals.calls).toBe(60);
    expect(r.totals.total).toBe(660);
  });
});
