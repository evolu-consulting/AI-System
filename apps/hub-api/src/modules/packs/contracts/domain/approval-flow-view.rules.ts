// CR-118 · UW-FR-10/13 · ADR-0035 · luật thuần: thẻ duyệt HĐ hôm nay (`ContractApproval`, cả `mode=engine` lẫn máy cũ) ⇒
// `FlowView` của khe `contracts.approval`. CHỈ chiếu dữ liệu đã có (không thêm quyết định): bước/trạng thái/hạn/người quyết giữ
// y hệt thẻ; hành động suy từ `can_act` + `task_id` + `finalizes_on_approve` (luật quyền vẫn ở engine/máy trạng thái). Lớp 1.

import type {
  FlowActionDef,
  FlowSkipCondSchema,
  FlowState,
  FlowStepStatus,
  FlowStepView,
  FlowSummaryItem,
  FlowTask,
  FlowView,
} from "@ai/contracts/flow";
import { moduleFlowStep } from "@ai/contracts/flow";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import type { z } from "zod";

export const APPROVAL_FLOW_SLOT = "contracts.approval";
export const PRODUCT_LINKS_EXTENSION = "contracts.product-links";
type Card = ContractApproval;
type CardStep = NonNullable<Card["steps"]>[number];
type SkipCond = z.infer<typeof FlowSkipCondSchema>;

const STATE_OF: Record<string, FlowState> = {
  extract: "running",
  level1: "running",
  value: "running",
  level2: "running",
  finalize: "running",
  done: "done",
  rejected: "rejected",
  cancelled: "cancelled",
};
export const flowStateOf = (step: string | null | undefined): FlowState =>
  (step ? STATE_OF[step] : undefined) ?? "none";

const skipOf = (s: CardStep): SkipCond[] | null =>
  s.skip_when
    ? s.skip_when.map((c): SkipCond => {
        if (c.field === "deal" || c.field === "creator_department")
          return { field: c.field, op: "in", value: [...c.in] };
        if (c.field === "new_partner") return { field: c.field, op: "is", value: c.is };
        return { field: c.field, op: c.op, value: c.value };
      })
    : null;

function stepOf(s: CardStep): FlowStepView {
  const base = {
    key: s.key,
    name: s.name,
    status: s.status as FlowStepStatus,
    due_at: s.due_at,
    overdue: s.overdue ?? false,
    escalated: s.escalated,
    escalated_to: s.escalated_to ?? null,
    decided_by: s.decided_by,
    decided_at: s.decided_at,
    decided_as: s.decided_as ?? null,
    feedback: s.feedback,
    skip_when: skipOf(s),
  };
  // CR-123 · u6 · cụm node module (Ký số = gửi + chờ) = MỘT dòng, trạng thái nghiệp vụ ở `outcome`.
  if (s.outcome) return moduleFlowStep(base, s.outcome, s.signer, s.module_node);
  if (s.kind === "dify") return { ...base, kind: "dify", assignee: { kind: "system" } };
  // CR-121 D-6b · Thông báo = bước hệ thống (không ai làm); Chờ tới = bước chờ tới giờ hẹn (`due_at`).
  if (s.kind === "notify") return { ...base, kind: "system", assignee: { kind: "system" } };
  if (s.kind === "wait_until")
    return { ...base, kind: "wait", until: s.due_at, assignee: { kind: "system" } };
  const g = s.escalated && s.escalated_group_id ? s.escalated_group_id : s.group_id;
  return {
    ...base,
    kind: "review",
    assignee: { kind: "group", id: g, label: s.escalated_to ?? null, head_only: s.head_only },
  };
}

const ESIGN_STATUS: Record<string, FlowStepStatus> = {
  pending: "pending",
  sending: "running",
  sent: "running",
  completed: "passed",
  needs_decision: "needs_decision",
};
function esignOf(e: NonNullable<Card["esign"]>): FlowStepView {
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

const FEEDBACK = { kind: "feedback" as const, required: true, max_len: 4000 };
/** Hành động của task đang mở — cùng luật thẻ duyệt: Trả lại chỉ ở lượt engine và không ở bước soạn (idx 0). */
function actionsOf(card: Card, openIdx: number | null): FlowActionDef[] {
  const approve: FlowActionDef = {
    key: "approve",
    label: "Duyệt",
    style: "primary",
    confirm: false,
    input: card.finalizes_on_approve
      ? { kind: "extension", key: PRODUCT_LINKS_EXTENSION, required: false }
      : { kind: "none" },
  };
  const out = [approve];
  if (card.mode === "engine" && openIdx !== null && openIdx > 0)
    out.push({
      key: "return",
      label: "Trả lại",
      style: "default",
      confirm: false,
      input: FEEDBACK,
    });
  out.push(
    { key: "redo", label: "Đọc lại", style: "default", confirm: true, input: FEEDBACK },
    { key: "reject", label: "Từ chối", style: "danger", confirm: true, input: FEEDBACK },
  );
  return out;
}

function tasksOf(card: Card): FlowTask[] {
  if (!card.can_act || !card.task_id) return [];
  const open = card.steps?.find((s) => s.status === "open") ?? null;
  return [
    {
      task_id: card.task_id,
      step_key: open?.key ?? card.step ?? "level1",
      kind: "review",
      actions: actionsOf(card, open ? open.idx : null),
    },
  ];
}

/** Thẻ duyệt ⇒ FlowView (`snapshotVersion` = `approvals.flow_version` của lượt; null ở máy cũ / chưa có run). */
export function flowViewOfCard(card: Card, ref: string, snapshotVersion: number | null): FlowView {
  const steps = (card.steps ?? []).map(stepOf);
  if (card.esign) steps.push(esignOf(card.esign));
  return {
    slot: APPROVAL_FLOW_SLOT,
    ref,
    run: card.run_id
      ? {
          id: card.run_id,
          mode: card.mode ?? "machine",
          status: card.run_status,
          snapshot_version: snapshotVersion,
        }
      : null,
    state: flowStateOf(card.step),
    phase: card.step,
    note: card.feedback,
    attention: card.attention ?? null,
    block_reason: card.block_reason ?? null,
    steps,
    tasks: tasksOf(card),
  };
}

/** Hàng tóm tắt (một câu SQL cho cả lô) ⇒ huy hiệu. */
export type ApprovalSummaryRow = {
  ref: string;
  status: string | null;
  mode: string | null;
  flow_version: number | null;
  /** lượt engine kẹt chưa có run / Ký số cần quyết (chi tiết lý do ở `view`). */
  attention: boolean;
};
const PHASE: Record<string, string> = {
  extracting: "extract",
  level1: "level1",
  level2: "level2",
  done: "done",
  rejected: "rejected",
  cancelled: "cancelled",
  failed: "cancelled",
};
/** Giai đoạn như thẻ: lượt engine gộp level2 ⇒ level1 (`cardStepOf`), máy cũ giữ level2. */
export function summaryItemOf(r: ApprovalSummaryRow): FlowSummaryItem {
  const raw = r.status ? (PHASE[r.status] ?? null) : null;
  const phase = r.mode === "engine" && raw === "level2" ? "level1" : raw;
  return {
    ref: r.ref,
    state: flowStateOf(phase),
    phase,
    snapshot_version: r.mode === "engine" ? r.flow_version : null,
    attention: r.attention,
  };
}
