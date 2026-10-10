// HUB-FR-105…117 · CR-056 · nạp 6 run cố định (plan-step0 §3) bằng chính hành động mock ⇒ tin thread, task, notice
// khớp trạng thái. Đồng hồ tất định (01:00Z + 1 phút/bước).
import type { ProcessRunUsage, TokenTotals, UsageCall } from "@ai/contracts/chat";
import { addOutput, forward, openAsk, openDecision, review } from "./actions";
import { at, PA_FIX, PERSONA, processByKey } from "./fixtures";
import { ATTEMPT_LIMIT, type MockRun, type ProcessState } from "./state";

const def = (key: string) => {
  const d = processByKey(key);
  if (!d) throw new Error(key);
  return d;
};

function must(s: ProcessState, id: string) {
  const t = s.task(id);
  if (!t) throw new Error(id);
  return t;
}

export function seedProcesses(s: ProcessState): void {
  let m = 0;
  s.clock = () => at(m++);
  const A = PERSONA.A.id;
  const mk = (id: string, key: string, input: string) =>
    s.createRun({ id, def: def(key), startedBy: A, input, roomId: PA_FIX.room });

  const running = mk(PA_FIX.runRunning, "sdlc", "Thêm báo cáo công nợ");
  s.pinned.push(PA_FIX.taskRunningPass);
  addOutput(s, running);
  review(s, must(s, PA_FIX.taskRunningPass), PERSONA.B.id, { result: "pass" });

  const rev = mk(PA_FIX.runReview, "hoa-don", "HD-12");
  s.pinned.push(PA_FIX.taskReview);
  addOutput(s, rev);

  const ask = mk(PA_FIX.runAsk, "hoa-don", "HD-13");
  s.pinned.push(PA_FIX.taskAsk);
  const t = openAsk(s, ask, "Kỳ kế toán nào?", ["Tháng 9", "Tháng 10"]);
  forward(s, t, { by: A, to: PERSONA.H.id, note: "Chị xem giúp kỳ này" });
  forward(s, t, { by: PERSONA.H.id, to: PERSONA.H2.id, note: null });

  const dec = mk(PA_FIX.runDecision, "hoa-don", "HD-14");
  s.pinned.push(PA_FIX.taskDecisionFail, PA_FIX.taskDecision);
  addOutput(s, dec);
  review(s, must(s, PA_FIX.taskDecisionFail), PERSONA.B.id, {
    result: "fail",
    feedback: "Thiếu mã số thuế",
  });
  s.stage(dec).attempt = ATTEMPT_LIMIT;
  openDecision(s, dec, "redo_limit");

  const done = mk(PA_FIX.runDone, "hoa-don", "HD-10");
  s.pinned.push(PA_FIX.taskDonePass);
  addOutput(s, done);
  review(s, must(s, PA_FIX.taskDonePass), PERSONA.T.id, { result: "pass" });
  addOutput(s, done);
  done.usage = usageOf(done);

  const cancelled = mk(PA_FIX.runCancelled, "hoa-don", "HD-11");
  addOutput(s, cancelled);
  s.finish(cancelled, "cancelled", A);
  s.clock = () => new Date().toISOString();
}

const totals = (input: number, output: number, calls = 1): TokenTotals => ({
  input,
  output,
  cache_read: 0,
  cache_write: 0,
  total: input + output,
  calls,
});
const sum = (xs: TokenTotals[]): TokenTotals =>
  xs.reduce((a, b) => ({
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    total: a.total + b.total,
    calls: a.calls + b.calls,
  }));
let step = 0;
const call = (
  role: UsageCall["role"],
  key: string,
  member: string | null,
  t: TokenTotals,
): UsageCall => ({
  step_id: `00000000-0000-4000-8000-0000000a0${String(500 + step++).padStart(3, "0")}`,
  role,
  member_key: member,
  agent: { key, name: key },
  model: "claude-sonnet",
  tokens: t,
  latency_ms: 1200,
  at: at(40),
});

/** Usage run `done`: stage 0 một agent, stage 1 nhóm `lead_plan` (1 plan + 3 thành viên). */
function usageOf(r: MockRun): ProcessRunUsage {
  step = 0;
  const c0 = [call("agent", "hd-read", null, totals(1200, 400))];
  const team = [
    call("plan", "lead", null, totals(800, 200)),
    call("member", "ke-toan-1", "m1", totals(1500, 600)),
    call("member", "ke-toan-2", "m2", totals(1400, 500)),
    call("member", "ke-toan-3", "m3", totals(1300, 450)),
  ];
  const t0 = sum(c0.map((c) => c.tokens));
  const t1 = sum(team.map((c) => c.tokens));
  return {
    process_run_id: r.id,
    detail: "full",
    totals: sum([t0, t1]),
    stages: [
      {
        stage_idx: 0,
        name: r.def.stages[0]?.name ?? "",
        totals: t0,
        attempts: 1,
        asks_count: 0,
        team_runs: [],
        calls: c0,
      },
      {
        stage_idx: 1,
        name: r.def.stages[1]?.name ?? "",
        totals: t1,
        attempts: 1,
        asks_count: 0,
        team_runs: [
          {
            id: "00000000-0000-4000-8000-0000000a0601",
            attempt: 1,
            mode: "lead_plan",
            status: "done",
            stop_reason: null,
            active_ms: 4800,
            totals: t1,
            calls: team,
          },
        ],
        calls: team,
      },
    ],
  };
}

/** Bản `summary` cho người xem `task` (T): bỏ `team_runs`, `calls`. */
export function summaryUsage(u: ProcessRunUsage): ProcessRunUsage {
  return {
    ...u,
    detail: "summary",
    stages: u.stages.map((s) => ({ ...s, team_runs: [], calls: [] })),
  };
}
