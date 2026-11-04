// CR-118 · cr118-flow-web · thẻ duyệt hiện có (`ContractApproval`) ⇒ `FlowView` của khe `contracts.approval` + chiều ngược
// `FlowStepView` ⇒ `TimelineRow` (dòng thời gian cũ). Thuần. Phản chiếu phép chiếu của hub (`approval-flow-view.rules.ts`) nhưng
// chạy Ở WEB trên dữ liệu thẻ đã tải: hành vi y hệt thẻ cũ, KHÔNG phụ thuộc cờ HUB_FLOW_RUNTIME và không thêm yêu cầu mạng.
// Khác hub: nhãn phòng lấy từ `/groups` (tên phòng ban đầu của bước) và `overdue` suy theo `now` khi hub cũ không gửi.
import type {
  ApprovalCardStep,
  ContractApproval,
  ContractGroup,
  FlowCond,
  FlowSkipCondSchema,
  FlowStepStatus,
  FlowStepView,
  FlowView,
} from "@ai/contracts";
import type { z } from "zod";
import type { TimelineRow } from "./engine-card";

export const APPROVAL_SLOT = "contracts.approval";
type SkipCond = z.infer<typeof FlowSkipCondSchema>;

const STATE: Record<string, FlowView["state"]> = {
  extract: "running",
  level1: "running",
  value: "running",
  level2: "running",
  finalize: "running",
  done: "done",
  rejected: "rejected",
  cancelled: "cancelled",
};

const nameOf = (groups: readonly ContractGroup[], id: string | null): string | null =>
  id === null ? null : (groups.find((g) => g.id === id)?.name ?? "");

const skipOf = (s: ApprovalCardStep): SkipCond[] | null =>
  s.skip_when
    ? s.skip_when.map((c) =>
        c.field === "deal"
          ? { field: "deal", op: "in" as const, value: [...c.in] }
          : { field: c.field, op: c.op, value: c.value },
      )
    : null;

/** Hub báo `overdue` thì tin; vắng ⇒ bước đang mở qua `due_at`. */
const overdueOf = (s: ApprovalCardStep, now: number): boolean =>
  s.overdue ?? (s.status === "open" && s.due_at !== null && Date.parse(s.due_at) < now);

function stepOf(s: ApprovalCardStep, groups: readonly ContractGroup[], now: number): FlowStepView {
  const base = {
    key: s.key,
    name: s.name,
    status: s.status as FlowStepStatus,
    due_at: s.due_at,
    overdue: overdueOf(s, now),
    escalated: s.escalated,
    escalated_to: s.escalated ? (s.escalated_to ?? nameOf(groups, s.escalated_group_id)) : null,
    decided_by: s.decided_by,
    decided_at: s.decided_at,
    decided_as: s.decided_as ?? null,
    feedback: s.feedback,
    skip_when: skipOf(s),
  };
  if (s.kind === "dify") return { ...base, kind: "dify", assignee: { kind: "system" } };
  return {
    ...base,
    kind: "review",
    assignee: {
      kind: "group",
      id: s.group_id,
      label: nameOf(groups, s.group_id),
      head_only: s.head_only,
    },
  };
}

const ESIGN_STATUS: Record<string, FlowStepStatus> = {
  pending: "pending",
  sending: "running",
  sent: "running",
  completed: "passed",
  needs_decision: "needs_decision",
};

function esignOf(e: NonNullable<ContractApproval["esign"]>): FlowStepView {
  return {
    kind: "esign",
    key: e.key,
    name: e.name,
    status: ESIGN_STATUS[e.status] ?? "pending",
    assignee: { kind: "system" },
    due_at: e.due_at ?? null,
    overdue: e.overdue ?? false,
    escalated: false,
    escalated_to: null,
    decided_by: null,
    decided_at: null,
    decided_as: null,
    feedback: null,
    skip_when: null,
    esign: {
      provider_status: e.status,
      reason: e.reason,
      can_resend: e.can_resend,
      reminded_at: e.reminded_at ?? null,
    },
  };
}

/**
 * Thẻ duyệt ⇒ FlowView (chỉ phần hiển thị dòng bước). `tasks` rỗng: nút Duyệt/Trả lại/Từ chối của thẻ vẫn do `useApprovalUi` lo
 * (cần lưu ô trước, hộp gắn sản phẩm…), không đi qua FlowPanel.
 */
export function flowViewOfApproval(
  card: ContractApproval,
  ref: string,
  groups: readonly ContractGroup[],
  now: number,
): FlowView {
  const steps = (card.steps ?? []).map((s) => stepOf(s, groups, now));
  if (card.esign) steps.push(esignOf(card.esign));
  return {
    slot: APPROVAL_SLOT,
    ref,
    run: card.run_id
      ? {
          id: card.run_id,
          mode: card.mode ?? "machine",
          status: card.run_status,
          snapshot_version: null,
        }
      : null,
    state: (card.step ? STATE[card.step] : undefined) ?? "none",
    phase: card.step,
    note: card.feedback,
    attention: card.attention ?? null,
    block_reason: card.block_reason ?? null,
    steps,
    tasks: [],
  };
}

const condOf = (c: SkipCond): FlowCond =>
  c.field === "deal"
    ? ({ field: "deal", in: (c.value as string[]).slice() } as FlowCond)
    : ({ field: c.field, op: c.op, value: c.value } as FlowCond);

/** Bước review/dify của FlowView ⇒ dòng thời gian cũ (`idx` = vị trí trong danh sách bước, như `ApprovalCardStep.idx`). */
export function rowOfFlowStep(s: FlowStepView, idx: number): TimelineRow {
  const g = s.assignee?.kind === "group" ? s.assignee : null;
  const flag = s.escalated ? "escalated" : s.overdue ? "overdue" : null;
  return {
    idx,
    name: s.name,
    group: g ? g.label : null,
    headOnly: g?.head_only ?? false,
    status: s.status as TimelineRow["status"],
    due: s.due_at ? { at: s.due_at, flag } : null,
    escalatedTo: s.escalated_to,
    decidedBy: s.decided_by?.name ?? null,
    decidedAt: s.decided_at,
    feedback: s.feedback,
    skipWhen: s.status === "pending" && s.skip_when?.length ? s.skip_when.map(condOf) : null,
    ownerOverride: s.decided_as === "owner_override",
    overdue: s.overdue,
  };
}
