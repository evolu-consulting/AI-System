// Clean Architecture community (arch-a6) · tập con kiểu `FlowView` của `@ai/contracts/flow` mà 3 khe Community dựng (chỉ bước
// agent / review / system; hành động none / feedback). Domain không import contracts; `adapters/flow-slots.ts` gán kết quả vào contract
// nên typecheck bắt lệch.

export type FlowState = "none" | "running" | "done" | "rejected" | "cancelled";
export type FlowStepStatus =
  | "pending"
  | "open"
  | "running"
  | "passed"
  | "skipped"
  | "returned"
  | "rejected"
  | "failed"
  | "needs_decision";

export type FlowAssignee =
  | { kind: "group"; id: string | null; label: string | null; head_only: boolean }
  | { kind: "user"; id: string; label: string | null }
  | { kind: "system" };

type StepBase = {
  key: string;
  name: string;
  status: FlowStepStatus;
  assignee: FlowAssignee | null;
  due_at: string | null;
  overdue: boolean;
  escalated: boolean;
  escalated_to: string | null;
  decided_by: { id: string; name: string } | null;
  decided_at: string | null;
  decided_as: "member" | "owner_override" | null;
  feedback: string | null;
  skip_when: null;
};
export type FlowStepView =
  | (StepBase & { kind: "review" })
  | (StepBase & { kind: "system" })
  | (StepBase & { kind: "agent"; agent: { key: string; summary: string | null } });

export type FlowActionInput =
  | { kind: "none" }
  | { kind: "feedback"; required: boolean; max_len: number };
export type FlowActionDef = {
  key: string;
  label: string;
  style: "primary" | "default" | "danger";
  confirm: boolean;
  input: FlowActionInput;
};
export type FlowTask = {
  task_id: string;
  step_key: string;
  kind: "review";
  actions: FlowActionDef[];
};

export type FlowView = {
  slot: string;
  ref: string;
  run: null;
  state: FlowState;
  phase: string | null;
  note: string | null;
  attention: null;
  block_reason: "not_reviewer" | "starter" | null;
  steps: FlowStepView[];
  tasks: FlowTask[];
};

export type FlowSummaryItem = {
  ref: string;
  state: FlowState;
  phase: string | null;
  snapshot_version: number | null;
  attention: boolean;
};
