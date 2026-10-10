// HUB-FR-105…117 · CR-056 · trạng thái mock quy trình (plan-step0 §3): run/stage/task/notice + tin thread phòng R +
// bus `/me/stream`. Mọi đổi trạng thái đi qua đây (seed, route, `/__mock/process`) ⇒ fixture và hành vi khớp nhau.
import type {
  DecisionReason,
  HistoryItem,
  OutputRef,
  ProcessNotice,
  ProcessOutput,
  ProcessRunStatus,
  ProcessRunUsage,
  RoomMessage,
  RoomProcessPart,
  StageRunStatus,
  TaskForward,
  TaskKind,
  TaskResult,
  TaskStatus,
} from "@ai/contracts/chat";
import { findUserById } from "../users";
import { GROUPS, genId, PA_FIX, type ProcessMeta, ROOM_MEMBERS, ref } from "./fixtures";
import { threadContent } from "./thread";

export type MockTask = {
  id: string;
  runId: string;
  kind: TaskKind;
  status: TaskStatus;
  stage_idx: number;
  output?: OutputRef;
  question?: string;
  choices?: string[];
  excerpt?: string;
  reason?: DecisionReason;
  has_output?: boolean;
  forwards: TaskForward[];
  result?: TaskResult;
  created_at: string;
  userIds: string[];
  groupId: string | null;
};
export type MockStage = {
  status: StageRunStatus;
  attempt: number;
  asks_count: number;
  outputs: ProcessOutput[];
  passed_by: string | null;
  passed_at: string | null;
};
export type MockRun = {
  id: string;
  def: ProcessMeta;
  status: ProcessRunStatus;
  stageIdx: number;
  startedBy: string;
  input: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  decisionReason: DecisionReason | null;
  stages: MockStage[];
  history: HistoryItem[];
  roomId: string | null;
  flowId: string | null;
  usage: ProcessRunUsage | null;
};
export type Emit = (userIds: readonly string[], event: string, data: unknown) => void;

export const ATTEMPT_LIMIT = 4;
export const ASK_LIMIT = 3;
const ACTIVE: readonly ProcessRunStatus[] = [
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
];
export const isActive = (s: ProcessRunStatus) => ACTIVE.includes(s);
export const userRef = (id: string) => {
  const u = findUserById(id);
  return u ? ref(u) : { id, display_name: "?" };
};

export class ProcessState {
  runs: MockRun[] = [];
  tasks: MockTask[] = [];
  notices: (ProcessNotice & { owner: string })[] = [];
  messages: RoomMessage[] = [];
  /** Người đã rời phòng R (persona `lan-left`, U5). */
  left = new Set<string>();
  private seq = 0;
  /** Đồng hồ tất định cho seed; route dùng giờ thật. */
  clock: () => string = () => new Date().toISOString();

  /** Id task kế tiếp (seed ghim id cố định `PA_FIX.task*`). */
  pinned: string[] = [];

  constructor(readonly emit: Emit) {}

  taskId(): string {
    return this.pinned.shift() ?? genId();
  }

  run(id: string) {
    return this.runs.find((r) => r.id === id);
  }
  task(id: string) {
    return this.tasks.find((t) => t.id === id);
  }
  roomMembers(): string[] {
    return ROOM_MEMBERS.filter((u) => !this.left.has(u));
  }
  groupMembers(groupId: string | null): readonly string[] {
    return groupId ? (GROUPS[groupId as keyof typeof GROUPS]?.members ?? []) : [];
  }
  assignees(t: MockTask): string[] {
    return [...new Set([...t.userIds, ...this.groupMembers(t.groupId)])];
  }
  openTasks(runId: string) {
    return this.tasks.filter((t) => t.runId === runId && t.status === "open");
  }

  // ---------- phát ----------
  private touch(r: MockRun) {
    r.updatedAt = this.clock();
    const to = new Set([r.startedBy, ...this.roomMembers()]);
    for (const t of this.openTasks(r.id)) for (const u of this.assignees(t)) to.add(u);
    this.emit([...to], "process.updated", {
      process_run_id: r.id,
      status: r.status,
      stage_idx: r.stageIdx,
    });
  }
  /** Tin `process` vào thread (U1): `block` ở main, còn lại `flow`; phát `room.message` cho thành viên hiện tại. */
  post(r: MockRun, part: RoomProcessPart): void {
    if (!r.roomId || !r.flowId) return;
    this.seq += 1;
    const msg: RoomMessage = {
      id: genId(),
      room_id: r.roomId,
      seq: this.seq,
      sender_type: "process",
      sender: { id: r.def.id, display_name: r.def.name },
      content: threadContent(part, r.def.name),
      client_msg_id: null,
      created_at: this.clock(),
      flow_id: r.flowId,
      placement: part.kind === "block" ? "main" : "flow",
      process_run_id: r.id,
      process: part,
    };
    this.messages.push(msg);
    this.emit(this.roomMembers(), "room.message", { room_id: r.roomId, message: msg });
  }
  notify(owner: string, kind: ProcessNotice["kind"], r: MockRun, task: MockTask | null): void {
    const n = {
      owner,
      id: genId(),
      kind,
      process_run_id: r.id,
      task_id: task?.id ?? null,
      process_name: r.def.name,
      stage_name: task ? (r.def.stages[task.stage_idx]?.name ?? null) : null,
      ...(task?.result ? { result: task.result } : {}),
      created_at: this.clock(),
      read: false,
    };
    this.notices.push(n);
    const { owner: _o, ...notice } = n;
    this.emit([owner], "process.notice", { notice, unread: this.unread(owner) });
  }
  unread(owner: string) {
    return this.notices.filter((n) => n.owner === owner && !n.read).length;
  }

  // ---------- run ----------
  createRun(o: {
    def: ProcessMeta;
    startedBy: string;
    input: string;
    roomId: string | null;
    id?: string;
  }) {
    const now = this.clock();
    const id = o.id ?? genId();
    const r: MockRun = {
      id,
      def: o.def,
      status: "running",
      stageIdx: 0,
      startedBy: o.startedBy,
      input: o.input,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      decisionReason: null,
      stages: o.def.stages.map((_, i) => ({
        status: i === 0 ? "running" : "pending",
        attempt: i === 0 ? 1 : 0,
        asks_count: 0,
        outputs: [],
        passed_by: null,
        passed_at: null,
      })),
      history: [],
      roomId: o.roomId,
      flowId: o.roomId ? (o.id ? PA_FIX.flow(o.id) : genId()) : null,
      usage: null,
    };
    this.runs.push(r);
    this.post(r, {
      kind: "block",
      process_run_id: id,
      process: { key: o.def.key, name: o.def.name },
      stage_count: o.def.stages.length,
    });
    this.touch(r);
    return r;
  }
  stage(r: MockRun) {
    return r.stages[r.stageIdx] as MockStage;
  }
  /** Stage hiện tại xong ⇒ sang stage kế (running) hoặc run `done`. */
  advance(r: MockRun, by: string | null): void {
    const s = this.stage(r);
    s.status = "done";
    if (by) {
      s.passed_by = by;
      s.passed_at = this.clock();
    }
    if (r.stageIdx + 1 >= r.stages.length) {
      this.finish(r, "done", null);
      return;
    }
    r.stageIdx += 1;
    const n = this.stage(r);
    n.status = "running";
    n.attempt += 1;
    r.status = "running";
    this.touch(r);
  }
  finish(r: MockRun, status: "done" | "cancelled" | "failed" | "expired", actor: string | null) {
    for (const t of this.openTasks(r.id)) this.close(t, "cancelled", null);
    const s = this.stage(r);
    if (status !== "done" && s.status !== "done")
      s.status = status === "cancelled" ? "cancelled" : "failed";
    r.status = status;
    r.finishedAt = this.clock();
    if (status === "cancelled") r.history.push(this.hist(r, "cancel", null, actor));
    this.post(r, {
      kind: "run_end",
      process_run_id: r.id,
      status,
      actor: actor ? userRef(actor) : null,
    });
    this.notify(r.startedBy, "run_finished", r, null);
    this.touch(r);
  }
  hist(
    r: MockRun,
    kind: HistoryItem["kind"],
    t: MockTask | null,
    actor: string | null,
  ): HistoryItem {
    return {
      at: this.clock(),
      kind,
      task_id: t?.id ?? null,
      stage_idx: t?.stage_idx ?? r.stageIdx,
      actor: actor ? userRef(actor) : null,
      ...(t?.result ? { result: t.result } : {}),
    };
  }

  // ---------- task ----------
  openTask(
    r: MockRun,
    t: Omit<MockTask, "runId" | "status" | "forwards" | "created_at" | "stage_idx"> & {
      stage_idx?: number;
    },
  ) {
    const task: MockTask = {
      stage_idx: r.stageIdx,
      ...t,
      runId: r.id,
      status: "open",
      forwards: [],
      created_at: this.clock(),
    };
    this.tasks.push(task);
    const kindEv = { task_id: task.id, kind: task.kind, process_run_id: r.id };
    this.emit(this.assignees(task), "review_task.created", kindEv);
    const notice = {
      review: "review_requested",
      ask: "ask_requested",
      decision: "decision_requested",
    } as const;
    for (const u of this.assignees(task)) this.notify(u, notice[task.kind], r, task);
    return task;
  }
  close(
    t: MockTask,
    result: TaskResult,
    actor: string | null,
    extra: Record<string, unknown> = {},
  ) {
    const r = this.run(t.runId) as MockRun;
    t.status = "closed";
    t.result = result;
    this.emit(this.assignees(t), "review_task.closed", { task_id: t.id, result });
    if (!actor) return;
    r.history.push({ ...this.hist(r, t.kind, t, actor), ...extra });
    this.post(r, {
      kind: "task_result",
      process_run_id: r.id,
      stage_idx: t.stage_idx,
      task_id: t.id,
      task_kind: t.kind,
      result,
      actor: userRef(actor),
      outside: !this.roomMembers().includes(actor),
      ...extra,
    });
  }
}
