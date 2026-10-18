// HUB-FR-106…111 · CR-056 · hành động mock trên run/task (dùng chung cho seed, route, `/__mock/process`). Luật rút gọn
// theo plan-contract §3 — đủ cho FE dựng giao diện; luật thật ở `modules/processes` (PF1–PF3).
import type { DecisionOption, DecisionReason, ExecutorRef, OutputRef } from "@ai/contracts/chat";
import { DECISION_OPTIONS } from "@ai/contracts/chat";
import { genId, PA_FIX, PERSONA } from "./fixtures";
import { ASK_LIMIT, type MockRun, type MockTask, type ProcessState, userRef } from "./state";

const md = (r: MockRun, v: number) =>
  `# ${r.def.stages[r.stageIdx]?.name}\n\n## Kết quả\nBản ${v} cho "${r.input}".\n`;

/** Output mới cho stage hiện tại; `review` ⇒ mở task kiểm (B + Group "Kế toán"), `auto` ⇒ sang stage kế. */
export function addOutput(s: ProcessState, r: MockRun): OutputRef {
  const st = s.stage(r);
  const meta = r.def.stages[r.stageIdx];
  const out = {
    id: genId(),
    stage_idx: r.stageIdx,
    version: st.outputs.length + 1,
    attempt: Math.max(st.attempt, 1),
    content: md(r, st.outputs.length + 1),
    fields: null,
    template_ok: true,
    template_missing: [],
    created_at: s.clock(),
  };
  st.outputs.push(out);
  const { stage_idx: _i, content: _c, fields: _f, ...oref } = out;
  const review = meta?.after === "review";
  const task = review
    ? s.openTask(r, {
        id: s.taskId(),
        kind: "review",
        output: oref,
        userIds: [PERSONA.B.id],
        groupId: PA_FIX.gKeToan,
      })
    : null;
  if (meta) {
    s.post(r, {
      kind: "output",
      process_run_id: r.id,
      stage_idx: r.stageIdx,
      stage_name: meta.name,
      executor: meta.executor,
      output: oref,
      after: meta.after,
      review_task_id: task?.id ?? null,
      steps: steps(meta.executor.kind),
    });
  }
  if (review) {
    st.status = "waiting_review";
    r.status = "waiting_review";
  } else s.advance(r, null);
  return oref;
}

/** Nhóm: 1 bước plan + 3 thành viên (fixture usage `done`). */
function steps(kind: ExecutorRef["kind"]) {
  const one = (role: "agent" | "plan" | "member", key: string, member: string | null) => ({
    role,
    member_key: member,
    agent: { key, name: key },
    model: "claude-sonnet",
    ms: 1200,
    tokens: 900,
  });
  // P-c2 · stage Áp / P-d1 · stage `wait_until`: Hub tự chạy, không bước agent.
  if (kind === "apply" || kind === "wait_until") return [];
  if (kind === "agent") return [one("agent", "hd-read", null)];
  return [
    one("plan", "lead", null),
    one("member", "ke-toan-1", "m1"),
    one("member", "ke-toan-2", "m2"),
    one("member", "ke-toan-3", "m3"),
  ];
}

export function openAsk(s: ProcessState, r: MockRun, question: string, choices: string[]) {
  const st = s.stage(r);
  st.asks_count += 1;
  st.status = "waiting_answer";
  r.status = "waiting_answer";
  const meta = r.def.stages[r.stageIdx];
  const task = s.openTask(r, {
    id: s.taskId(),
    kind: "ask",
    question,
    choices,
    excerpt: r.input.slice(0, 1000),
    userIds: [r.startedBy],
    groupId: null,
  });
  if (meta) {
    s.post(r, {
      kind: "ask",
      process_run_id: r.id,
      stage_idx: r.stageIdx,
      stage_name: meta.name,
      executor: meta.executor,
      task_id: task.id,
      question,
      choices,
      asks_count: st.asks_count,
      ask_limit: ASK_LIMIT,
    });
  }
  return task;
}

export function openDecision(s: ProcessState, r: MockRun, reason: DecisionReason) {
  const hasOutput = s.stage(r).outputs.length > 0;
  const options = DECISION_OPTIONS.filter((o) => hasOutput || o !== "use_current");
  s.stage(r).status = "needs_decision";
  r.status = "needs_decision";
  r.decisionReason = reason;
  const task = s.openTask(r, {
    id: s.taskId(),
    kind: "decision",
    reason,
    has_output: hasOutput,
    userIds: [r.startedBy],
    groupId: reason === "redo_limit" ? PA_FIX.gKeToan : null,
  });
  s.post(r, {
    kind: "decision",
    process_run_id: r.id,
    stage_idx: r.stageIdx,
    task_id: task.id,
    reason,
    options: [...options],
  });
  return task;
}

export function review(
  s: ProcessState,
  t: MockTask,
  by: string,
  b: { result: "pass" | "fail"; feedback?: string },
) {
  const r = s.run(t.runId) as MockRun;
  s.close(t, b.result, by, b.feedback ? { feedback: b.feedback } : {});
  if (b.result === "pass") return s.advance(r, by);
  const st = s.stage(r);
  st.attempt += 1;
  st.status = "running";
  r.status = "running";
}

export function answer(
  s: ProcessState,
  t: MockTask,
  by: string,
  b: { answer: string; choice?: string },
) {
  const r = s.run(t.runId) as MockRun;
  s.close(t, "answer", by, { answer: b.answer, ...(b.choice ? { choice: b.choice } : {}) });
  s.stage(r).status = "running";
  r.status = "running";
}

export function forward(
  s: ProcessState,
  t: MockTask,
  f0: { by: string; to: string; note: string | null },
) {
  const { by, to, note } = f0;
  const r = s.run(t.runId) as MockRun;
  const f = { from: userRef(by), to: userRef(to), note, at: s.clock() };
  t.forwards.push(f);
  t.userIds.push(to);
  r.history.push({ ...s.hist(r, "forward", t, by), to: f.to, ...(note ? { note } : {}) });
  s.post(r, {
    kind: "forward",
    process_run_id: r.id,
    stage_idx: t.stage_idx,
    task_id: t.id,
    task_kind: t.kind,
    from: f.from,
    to: f.to,
    depth: t.forwards.length,
  });
  s.emit([to], "review_task.created", { task_id: t.id, kind: t.kind, process_run_id: r.id });
  s.notify(to, t.kind === "ask" ? "ask_requested" : "review_requested", r, t);
}

export function decide(s: ProcessState, r: MockRun, by: string, option: DecisionOption) {
  const t = s.openTasks(r.id).find((x) => x.kind === "decision");
  if (t) s.close(t, option, by);
  r.decisionReason = null;
  if (option === "cancel") return s.finish(r, "cancelled", by);
  if (option === "use_current") return s.advance(r, by);
  const st = s.stage(r);
  st.attempt += 1;
  st.status = "running";
  r.status = "running";
}
