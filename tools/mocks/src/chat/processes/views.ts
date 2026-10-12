// HUB-BR-25 · HUB-FR-115 · U5 · dựng view theo người xem (plan-contract §2, §5 plan): full (admin / thành viên phòng /
// người bắt đầu không phòng) · task (assignee ngoài phòng / người bắt đầu đã rời) · null ⇒ 404.
import type {
  OutputRef,
  ProcessRunSummary,
  ProcessRunView,
  StageView,
  TaskDetail,
} from "@ai/contracts/chat";
import { DECISION_OPTIONS, PROCESS_BACK_ROUNDS_MAX } from "@ai/contracts/chat";
import { findUserById } from "../users";
import { GROUPS, PA_FIX } from "./fixtures";
import {
  ASK_LIMIT,
  ATTEMPT_LIMIT,
  isActive,
  type MockRun,
  type MockTask,
  type ProcessState,
  userRef,
} from "./state";

export type Viewer = { id: string; admin: boolean };
export const viewerOf = (userId: string): Viewer => ({
  id: userId,
  admin: findUserById(userId)?.role === "tenant_admin",
});

export function access(s: ProcessState, v: Viewer, r: MockRun | undefined): "full" | "task" | null {
  if (!r) return null;
  if (v.admin) return "full";
  if (r.roomId && s.roomMembers().includes(v.id)) return "full";
  if (r.startedBy === v.id) return r.roomId ? "task" : "full";
  return s.tasks.some((t) => t.runId === r.id && s.assignees(t).includes(v.id)) ? "task" : null;
}

const canDecide = (s: ProcessState, v: Viewer, r: MockRun) =>
  v.admin ||
  r.startedBy === v.id ||
  (r.decisionReason === "redo_limit" && s.groupMembers(PA_FIX.gKeToan).includes(v.id));

export function canAct(s: ProcessState, v: Viewer, t: MockTask): boolean {
  const r = s.run(t.runId);
  if (!r || t.status !== "open" || !isActive(r.status)) return false;
  return t.kind === "decision" ? canDecide(s, v, r) : s.assignees(t).includes(v.id);
}
export const canCancel = (v: Viewer, r: MockRun) =>
  isActive(r.status) && (v.admin || r.startedBy === v.id);

export function taskDetail(s: ProcessState, v: Viewer, t: MockTask): TaskDetail {
  const r = s.run(t.runId) as MockRun;
  const hasOutput = (r.stages[t.stage_idx]?.outputs.length ?? 0) > 0;
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    stage_idx: t.stage_idx,
    stage_name: r.def.stages[t.stage_idx]?.name ?? "",
    ...(t.output ? { output: t.output } : {}),
    ...(t.question ? { question: t.question, choices: t.choices ?? [] } : {}),
    ...(t.excerpt !== undefined ? { excerpt: t.excerpt } : {}),
    ...(t.kind === "decision"
      ? {
          reason: t.reason ?? "redo_limit",
          options: DECISION_OPTIONS.filter((o) => hasOutput || o !== "use_current"),
          has_output: hasOutput,
        }
      : {}),
    forwards: t.forwards,
    ...(t.result ? { result: t.result } : {}),
    can_act: canAct(s, v, t),
    created_at: t.created_at,
  };
}

export function summary(r: MockRun): ProcessRunSummary {
  return {
    id: r.id,
    process: { key: r.def.key, name: r.def.name, version: 1 },
    status: r.status,
    current_stage_idx: r.stageIdx,
    stage_count: r.def.stages.length,
    started_by: userRef(r.startedBy),
    origin: r.roomId ? { kind: "room", room_id: r.roomId } : { kind: "conversation" },
    started_at: r.startedAt,
    updated_at: r.updatedAt,
    finished_at: r.finishedAt,
    ...(r.decisionReason ? { decision_reason: r.decisionReason } : {}),
    // P-b2 · mock: mỗi stage một bước (def mock không có `step`).
    current_step: r.stageIdx,
    step_count: r.def.stages.length,
  };
}

const outRef = (o: OutputRef & Record<string, unknown>): OutputRef => ({
  id: o.id,
  version: o.version,
  attempt: o.attempt,
  template_ok: o.template_ok,
  template_missing: o.template_missing,
  created_at: o.created_at,
});

function stageViews(r: MockRun): StageView[] {
  return r.def.stages.map((m, idx) => {
    const st = r.stages[idx];
    const outputs = (st?.outputs ?? []).map(outRef);
    return {
      idx,
      key: m.key,
      name: m.name,
      executor: m.executor,
      after: m.after,
      real_action: m.real_action,
      status: st?.status ?? "pending",
      attempt: st?.attempt ?? 0,
      attempt_limit: ATTEMPT_LIMIT,
      asks_count: st?.asks_count ?? 0,
      ask_limit: ASK_LIMIT,
      outputs,
      current_output_id: outputs.at(-1)?.id ?? null,
      passed_by: st?.passed_by ? userRef(st.passed_by) : null,
      passed_at: st?.passed_at ?? null,
      step: idx,
      round: 1,
      back_to_steps: [],
    };
  });
}

function fullView(s: ProcessState, v: Viewer, r: MockRun): ProcessRunView {
  const open = s.openTasks(r.id);
  const reason = r.decisionReason;
  return {
    ...summary(r),
    access: "full",
    input: r.input,
    stages: stageViews(r),
    history: r.history.slice(-200),
    decision:
      r.status === "needs_decision" && reason
        ? {
            reason,
            stage_idx: r.stageIdx,
            options: DECISION_OPTIONS.filter(
              (o) => s.stage(r).outputs.length > 0 || o !== "use_current",
            ),
            can_decide: canDecide(s, v, r),
          }
        : null,
    my_tasks: open.filter((t) => canAct(s, v, t)).map((t) => taskDetail(s, v, t)),
    open_tasks: open.map((t) => ({
      id: t.id,
      kind: t.kind,
      stage_idx: t.stage_idx,
      assignees: t.userIds.map(userRef),
      group: t.groupId
        ? { id: t.groupId, name: GROUPS[t.groupId as keyof typeof GROUPS]?.name ?? "?" }
        : null,
    })),
    thread:
      r.roomId && r.flowId && s.roomMembers().includes(v.id)
        ? { room_id: r.roomId, flow_id: r.flowId }
        : null,
    can_cancel: canCancel(v, r),
    back_rounds: 0,
    back_limit: PROCESS_BACK_ROUNDS_MAX,
    back_events: [],
  };
}

function taskView(s: ProcessState, v: Viewer, r: MockRun): ProcessRunView {
  const startedLeft = r.startedBy === v.id;
  const mine = startedLeft
    ? []
    : s.tasks.filter((t) => t.runId === r.id && s.assignees(t).includes(v.id));
  return {
    access: "task",
    id: r.id,
    process: { key: r.def.key, name: r.def.name },
    status: r.status,
    stages: isActive(r.status)
      ? r.def.stages.map((m, idx) => ({
          idx,
          name: m.name,
          status: r.stages[idx]?.status ?? "pending",
          step: idx,
          round: 1,
        }))
      : [],
    my_tasks: mine.map((t) => taskDetail(s, v, t)),
    ...(startedLeft
      ? { outputs: r.stages.flatMap((st) => st.outputs.map(outRef)), can_cancel: canCancel(v, r) }
      : {}),
  };
}

export function runView(s: ProcessState, v: Viewer, r: MockRun): ProcessRunView | null {
  const a = access(s, v, r);
  if (a === "full") return fullView(s, v, r);
  return a === "task" ? taskView(s, v, r) : null;
}
