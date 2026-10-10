// HUB-FR-113 · U1 · dựng `RoomProcessPart` hợp lệ cả 7 kind (plan-contract §2, plan-thread §2) — thuần, không DB/env
// (dùng cho rules R-K09/R-TK06 và fixture `process_thread_events`).
// biome-ignore lint/suspicious/noExplicitAny: object thử nghiệm theo contract
type Json = any;
type Who = { id: string; display_name?: string; username?: string };

let n = 0;
const gen = () => `a5a00000-0000-4000-8000-${String(800_000 + n++).padStart(12, "0")}`;
const AT = "2026-10-10T01:00:00.000Z";
export const EXECUTOR = { kind: "agent", key: "hoadon", name: { vi: "Hoá đơn", en: "Invoice" } };
const ref = (u: Who) => ({ id: u.id, display_name: u.display_name ?? u.username ?? "user" });
const LAN = { id: "a1000000-0000-4000-8000-000000000101", display_name: "lan" };
const Q01 = { id: "a2a00000-0000-4000-8000-000000000101", display_name: "QC Người 01" };

export const outputRef = (id = gen()) => ({
  id,
  version: 1,
  attempt: 1,
  template_ok: true,
  template_missing: [],
  created_at: AT,
});

export const part = {
  block: (runId: string, name = "Hoá đơn thử", key = "hoa-don-t"): Json => ({
    kind: "block",
    process_run_id: runId,
    process: { key, name },
    stage_count: 2,
  }),
  output: (runId: string, outputId = gen()): Json => ({
    kind: "output",
    process_run_id: runId,
    stage_idx: 0,
    stage_name: "Đọc hoá đơn",
    executor: EXECUTOR,
    output: outputRef(outputId),
    after: "review",
    review_task_id: null,
    steps: [],
  }),
  ask: (runId: string, taskId = gen()): Json => ({
    kind: "ask",
    process_run_id: runId,
    stage_idx: 0,
    stage_name: "Đọc hoá đơn",
    executor: EXECUTOR,
    task_id: taskId,
    question: "Kỳ kế toán nào?",
    choices: ["Tháng 9", "Tháng 10"],
    asks_count: 1,
    ask_limit: 3,
  }),
  decision: (runId: string, taskId = gen()): Json => ({
    kind: "decision",
    process_run_id: runId,
    stage_idx: 0,
    task_id: taskId,
    reason: "redo_limit",
    options: ["add_attempt", "use_current", "cancel"],
  }),
  task_result: (runId: string, actor: Who = LAN, taskId = gen(), extra: Json = {}): Json => ({
    kind: "task_result",
    process_run_id: runId,
    stage_idx: 0,
    task_id: taskId,
    task_kind: "review",
    result: "pass",
    actor: ref(actor),
    outside: false,
    ...extra,
  }),
  forward: (runId: string, taskId = gen()): Json => ({
    kind: "forward",
    process_run_id: runId,
    stage_idx: 0,
    task_id: taskId,
    task_kind: "ask",
    from: LAN,
    to: Q01,
    depth: 1,
  }),
  run_end: (runId: string): Json => ({
    kind: "run_end",
    process_run_id: runId,
    status: "done",
    actor: null,
  }),
};
export const KINDS = [
  "block",
  "output",
  "ask",
  "decision",
  "task_result",
  "forward",
  "run_end",
] as const;
/** Đủ 7 kind cho một run. */
export const allParts = (runId: string): Json[] => [
  part.block(runId),
  part.output(runId),
  part.ask(runId),
  part.decision(runId),
  part.task_result(runId),
  part.forward(runId),
  part.run_end(runId),
];
