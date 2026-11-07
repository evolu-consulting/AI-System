// CR-120 · cr120-community-flows · chiếu hàng của 3 khe Community sang `FlowView` (contract `@ai/contracts/flow`). Thuần; mode
// `machine` (lượt do gói giữ). Task chỉ có khi người xem là người duyệt và bước duyệt đang mở (task id = cột `*task_id` của hàng).

import {
  AGENT_SCREEN,
  AGENT_TRIAGE,
  awaitingReview,
  type Moderation,
  type ModRow,
  reviewClock,
  type Screen,
  SLOT_JOIN,
  SLOT_MODERATION,
  SLOT_REPORT,
} from "./flow.rules";
import type {
  FlowActionDef,
  FlowState,
  FlowStepView,
  FlowSummaryItem,
  FlowView,
} from "./flow-view.types";

type Status = FlowStepView["status"];
type Decided = {
  decided_by: string | null;
  decided_name: string | null;
  decided_at: string | null;
  feedback: string | null;
};

const base = {
  assignee: null,
  due_at: null,
  overdue: false,
  escalated: false,
  escalated_to: null,
  decided_by: null,
  decided_at: null,
  decided_as: null,
  feedback: null,
  skip_when: null,
} as const;
const group = (label: string) => ({ kind: "group", id: null, label, head_only: false }) as const;
const decided = (d: Decided) =>
  d.decided_by
    ? {
        decided_by: { id: d.decided_by, name: d.decided_name ?? "" },
        decided_at: d.decided_at,
        decided_as: "member" as const,
        feedback: d.feedback,
      }
    : {};

const APPROVE: FlowActionDef = {
  key: "approve",
  label: "Duyệt",
  style: "primary",
  confirm: false,
  input: { kind: "none" },
};
const REJECT: FlowActionDef = {
  key: "reject",
  label: "Từ chối",
  style: "danger",
  confirm: true,
  input: { kind: "feedback", required: false, max_len: 4000 },
};
const REPORT_ACTIONS: FlowActionDef[] = [
  { key: "hide", label: "Ẩn bài", style: "danger", confirm: true, input: { kind: "none" } },
  {
    key: "warn",
    label: "Cảnh báo",
    style: "default",
    confirm: false,
    input: { kind: "feedback", required: false, max_len: 4000 },
  },
  { key: "dismiss", label: "Bỏ qua", style: "default", confirm: false, input: { kind: "none" } },
];

function shell(slot: string, ref: string, state: FlowState, phase: string | null): FlowView {
  return {
    slot,
    ref,
    run: null,
    state,
    phase,
    note: null,
    attention: null,
    block_reason: null,
    steps: [],
    tasks: [],
  };
}

export type ModViewRow = ModRow &
  Decided & { id: string; mod_task_id: string | null; mod_reason: string | null };

const screenStatus = (s: Screen | null, stale: boolean): Status =>
  s === "running"
    ? stale
      ? "failed"
      : "running"
    : s === "error"
      ? "failed"
      : s
        ? "passed"
        : "pending";

const MOD_STATE: Record<Moderation, FlowState> = {
  none: "none",
  pending: "running",
  approved: "done",
  rejected: "rejected",
};

function reviewStatusOf(r: ModViewRow, open: boolean): Status {
  if (open) return "open";
  if (r.moderation === "rejected") return "rejected";
  if (r.moderation === "approved") return r.decided_by ? "passed" : "skipped";
  return "pending";
}

function screenStep(r: ModViewRow, stale: boolean): FlowStepView {
  return {
    ...base,
    kind: "agent",
    key: "screen",
    name: "Agent sàng lọc",
    status: screenStatus(r.mod_screen, stale),
    assignee: { kind: "system" },
    agent: {
      key: AGENT_SCREEN,
      summary: r.mod_screen === "flagged" ? (r.mod_reason ?? "Gắn cờ").slice(0, 400) : null,
    },
  };
}

function reviewStep(r: ModViewRow, open: boolean, now: number): FlowStepView {
  const clock = reviewClock(r.mod_at, now);
  return {
    ...base,
    kind: "review",
    key: "review",
    name: "Quản trị duyệt bài",
    status: reviewStatusOf(r, open),
    assignee: group("Quản trị Community"),
    ...(open ? clock : {}),
    escalated_to: open && clock.escalated ? "Tenant admin" : null,
    ...decided(r),
  };
}

/** Khe duyệt bài. `moderation = none` (bài trước khi khe có def) ⇒ state none, không bước. */
export function moderationView(r: ModViewRow, o: { reviewer: boolean; now: number }): FlowView {
  const v = shell(SLOT_MODERATION, r.id, MOD_STATE[r.moderation], r.moderation);
  if (r.moderation === "none") return v;
  const open = awaitingReview(r, o.now);
  const stale = open && r.mod_screen === "running";
  const done = r.moderation === "approved" || r.moderation === "rejected";
  const publish: Status = r.moderation === "approved" ? "passed" : done ? "rejected" : "pending";
  v.steps = [
    screenStep(r, stale),
    reviewStep(r, open, o.now),
    {
      ...base,
      kind: "system",
      key: "publish",
      name: "Ghi kết quả duyệt",
      status: publish,
      assignee: { kind: "system" },
    },
  ];
  if (r.mod_screen === "clean") v.note = "Bài sạch — đăng ngay";
  if (open && o.reviewer && r.mod_task_id)
    v.tasks = [
      { task_id: r.mod_task_id, step_key: "review", kind: "review", actions: [APPROVE, REJECT] },
    ];
  return v;
}
export type JoinViewRow = Decided & {
  id: string;
  status: "pending" | "approved" | "rejected";
  task_id: string;
  created_at: string;
  company: string;
};

export function joinView(r: JoinViewRow, o: { reviewer: boolean }): FlowView {
  const state: FlowState =
    r.status === "approved" ? "done" : r.status === "rejected" ? "rejected" : "running";
  const v = shell(SLOT_JOIN, r.id, state, r.status);
  const open = r.status === "pending";
  v.steps = [
    {
      ...base,
      kind: "system",
      key: "apply",
      name: "Form xin tham gia",
      status: "passed",
      decided_at: r.created_at,
    },
    {
      ...base,
      kind: "review",
      key: "review",
      name: "Tenant admin duyệt",
      status: open ? "open" : r.status === "approved" ? "passed" : "rejected",
      assignee: group("Tenant admin"),
      ...decided(r),
    },
    {
      ...base,
      kind: "system",
      key: "link",
      name: "Tạo liên kết đối tác",
      status: r.status === "approved" ? "passed" : r.status === "rejected" ? "skipped" : "pending",
      assignee: { kind: "system" },
    },
  ];
  if (open && o.reviewer)
    v.tasks = [
      { task_id: r.task_id, step_key: "review", kind: "review", actions: [APPROVE, REJECT] },
    ];
  return v;
}

export type ReportViewRow = Decided & {
  id: string;
  status: "pending" | "resolved";
  triage: "running" | "done" | "error";
  triage_kind: string | null;
  triage_level: string | null;
  action: "hide" | "warn" | "dismiss" | null;
  task_id: string;
};

export function reportView(r: ReportViewRow, o: { reviewer: boolean }): FlowView {
  const open = r.status === "pending";
  const v = shell(SLOT_REPORT, r.id, open ? "running" : "done", r.action ?? r.status);
  v.steps = [
    {
      ...base,
      kind: "agent",
      key: "triage",
      name: "Agent phân loại",
      status: r.triage === "done" ? "passed" : r.triage === "error" ? "failed" : "running",
      assignee: { kind: "system" },
      agent: {
        key: AGENT_TRIAGE,
        summary: r.triage_kind ? `${r.triage_kind} · ${r.triage_level ?? "?"}` : null,
      },
    },
    {
      ...base,
      kind: "review",
      key: "review",
      name: "Điều phối viên xử lý",
      status: open ? "open" : "passed",
      assignee: group("Quản trị Community"),
      ...decided(r),
    },
    {
      ...base,
      kind: "system",
      key: "action",
      name: "Thực hiện hành động",
      status: open ? "pending" : "passed",
      assignee: { kind: "system" },
    },
  ];
  if (open && o.reviewer)
    v.tasks = [{ task_id: r.task_id, step_key: "review", kind: "review", actions: REPORT_ACTIONS }];
  return v;
}

/** Huy hiệu danh sách từ view (cùng luật state/phase/attention). */
export const summaryOf = (v: {
  ref: string;
  state: FlowState;
  phase: string | null;
  tasks: readonly unknown[];
}): FlowSummaryItem => ({
  ref: v.ref,
  state: v.state,
  phase: v.phase,
  snapshot_version: null,
  attention: v.tasks.length > 0,
});
