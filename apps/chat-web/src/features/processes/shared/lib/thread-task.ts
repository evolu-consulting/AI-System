// CR-056 · P-a plan-frontend-thread §2: việc cần làm trong thread — ai bấm được, ai chỉ chờ. Thuần, có test.
import type { OpenTask, ProcessRunView, RoomProcessPart, TaskDetail } from "@ai/contracts/chat";

export type TaskSlot =
  | { state: "mine"; task: TaskDetail }
  | { state: "waiting"; open: OpenTask }
  | { state: "none" };

type OutputPart = Extract<RoomProcessPart, { kind: "output" }>;

/**
 * `mine` = có trong `my_tasks`, hoặc là task decision và `view.decision.can_decide` (admin quyết được dù không là assignee);
 * `waiting` = có trong `open_tasks`; còn lại `none` (việc đã đóng, hoặc view dạng `task`/chưa tải).
 */
export function taskSlot(view: ProcessRunView | undefined, taskId: string): TaskSlot {
  if (!view) return { state: "none" };
  const mine = view.my_tasks.find((t) => t.id === taskId);
  if (mine) return { state: "mine", task: mine };
  if (view.access !== "full") return { state: "none" };
  const open = view.open_tasks.find((t) => t.id === taskId);
  if (open) {
    if (open.kind === "decision" && view.decision?.can_decide) {
      return { state: "mine", task: decisionTaskOf(view, open) };
    }
    return { state: "waiting", open };
  }
  return { state: "none" };
}

/** Admin quyết được nhưng không có `TaskDetail` riêng: dựng tối thiểu từ `view.decision`. */
function decisionTaskOf(
  view: Extract<ProcessRunView, { access: "full" }>,
  open: OpenTask,
): TaskDetail {
  const stage = view.stages[open.stage_idx];
  return {
    id: open.id,
    kind: "decision",
    status: "open",
    stage_idx: open.stage_idx,
    stage_name: stage?.name ?? view.process.name,
    ...(view.decision && { reason: view.decision.reason, options: view.decision.options }),
    forwards: [],
    can_act: true,
    created_at: view.updated_at,
  };
}

/** "A, B" / "A, B và n người khác" — trả phần dữ liệu; chữ ghép do component (i18n `thread.wait.*`). */
export type WaitNames =
  | { kind: "group"; group: string }
  | { kind: "people"; names: string[]; more: number }
  | { kind: "none" };

export function waitNames(open: OpenTask, max = 3): WaitNames {
  if (open.group && open.assignees.length === 0) return { kind: "group", group: open.group.name };
  if (open.assignees.length === 0) return { kind: "none" };
  const names = open.assignees.slice(0, max).map((u) => u.display_name);
  return { kind: "people", names, more: Math.max(open.assignees.length - max, 0) };
}

/** Tóm tắt các bước của một tin `output`: số bước, tổng ms (bỏ `null`), tổng token. */
export function stepsSummary(steps: OutputPart["steps"]): {
  count: number;
  ms: number | null;
  tokens: number;
} {
  const known = steps.filter((s) => s.ms !== null);
  return {
    count: steps.length,
    ms: known.length === 0 ? null : known.reduce((a, s) => a + (s.ms ?? 0), 0),
    tokens: steps.reduce((a, s) => a + s.tokens, 0),
  };
}

/** Tiêu đề pane thread: `{tên} · !{key}` từ tin khối gốc; `process` vắng/hỏng ⇒ `content` (BE giữ tóm tắt). */
export function threadTitle(msg: { process?: RoomProcessPart; content: string }): string {
  const p = msg.process;
  return p?.kind === "block" ? `${p.process.name} · !${p.process.key}` : msg.content;
}
