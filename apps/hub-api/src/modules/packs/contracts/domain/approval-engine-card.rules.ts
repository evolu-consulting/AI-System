// contract-flow S3b · luật thuần (lớp 1) của thẻ duyệt HĐ chạy trên engine: dòng thời gian stage của engine (`stepsView`) ⇒ các bước
// người dùng của mẫu chụp (bỏ stage `route`/`finalize`), bước đang mở + task + `can_act`, `finalizes_on_approve`, lý do bị chặn;
// và kế hoạch cho hành động (Đạt / Trả lại / Từ chối / Đọc lại) trước khi gọi engine. Domain chỉ import builtin (ADR-0023): kiểu
// vào là cấu trúc khớp `PackStepsView` của kit.
import { finalizesOnApprove, isTerminalRun } from "./approval-engine.rules";
import {
  condHolds,
  type FlowEngineStep,
  type FlowFacts,
  type FlowStep,
  stepApplies,
} from "./approval-flow.rules";
import type { FlowCond } from "./approval-flow.types";
import { type DecidedAs, decidedAsOf } from "./approval-owner.rules";

export type CardStepStatus =
  | "pending"
  | "open"
  | "passed"
  | "skipped"
  | "returned"
  | "rejected"
  | "running"
  | "failed";
/** Một stage engine (khớp `PackStepView` — chỉ trường dùng). */
export type EngineStageView = {
  key: string;
  status: CardStepStatus;
  escalated_group_id: string | null;
  due_at: string | null;
  escalated: boolean;
  decided_by: { id: string; name: string } | null;
  decided_at: string | null;
  feedback: string | null;
  /** CR-113 · `override` = người xem quyết được chỉ nhờ quyền Toàn quyền (duyệt thay). */
  task: { id: string; can_act: boolean; override?: boolean } | null;
  /** CR-113 · id task review gần nhất của stage (khớp lần "duyệt thay" đã ghi). */
  task_ref?: string | null;
};
export type EngineStepsView = {
  status: string;
  started_by: string;
  steps: EngineStageView[];
  /** CR-107 · decision mở của run `needs_decision` (lý do + lúc mở). */
  decision?: { reason: string; at: string | null } | null;
};
/** CR-107 · lượt cần owner/admin để ý (không đổi trạng thái HĐ). */
export type EngineAttention = {
  kind: "needs_decision" | "stalled";
  reason: string | null;
  since: string | null;
};

export type CardStep = {
  idx: number;
  key: string;
  name: string;
  kind: "review" | "dify";
  status: CardStepStatus;
  group_id: string | null;
  head_only: boolean;
  escalated_group_id: string | null;
  due_at: string | null;
  escalated: boolean;
  decided_by: { id: string; name: string } | null;
  decided_at: string | null;
  feedback: string | null;
  /** CR-109 · điều kiện `when` không thỏa (bước chưa tới sẽ bị bỏ qua); null = không bỏ qua. */
  skip_when: FlowCond[] | null;
  /** CR-113 · bước đã quyết: người của bước (`member`) hay chủ gói duyệt thay (`owner_override`); chưa quyết ⇒ vắng. */
  decided_as?: DecidedAs;
  /** CR-113 · bước đang mở đã quá hạn (giờ server). */
  overdue?: boolean;
  /** CR-113 · tên Group nhận khi chuyển cấp đã xảy ra (vắng khi chưa chuyển cấp / không biết tên). */
  escalated_to?: string;
};

/** CR-113 · dữ liệu phụ của thẻ: task đã "duyệt thay", giờ server, tên Group (id ⇒ tên). Vắng ⇒ không hiện trường tương ứng. */
export type CardExtras = {
  overrides?: ReadonlySet<string>;
  now?: Date;
  groupNames?: ReadonlyMap<string, string>;
};

/** CR-113 · trường "duyệt thay / quá hạn / chuyển cấp tới" của một bước. */
function ownerFields(st: EngineStageView | undefined, x: CardExtras) {
  if (!st) return {};
  const decider = st.status !== "open" ? st.decided_by?.id : null;
  const as = decidedAsOf(decider, st.task_ref, x.overrides ?? new Set());
  const due = st.due_at ? Date.parse(st.due_at) : Number.NaN;
  const overdue = st.status === "open" && x.now !== undefined && due < x.now.getTime();
  // CR-113 (review) · tên Group cắt an toàn ≤ 200 ký tự (= `escalated_to` của contract).
  const to =
    st.escalated && st.escalated_group_id
      ? x.groupNames?.get(st.escalated_group_id)?.slice(0, 200)
      : undefined;
  return {
    ...(as ? { decided_as: as } : {}),
    ...(st.status === "open" && x.now ? { overdue } : {}),
    ...(to ? { escalated_to: to } : {}),
  };
}

/** CR-109 · bước review chưa tới (không phải bước soạn) mà `contracts-route` sẽ bỏ qua với facts hiện tại: các điều kiện không thỏa. */
export function willSkip(s: FlowEngineStep, i: number, facts: FlowFacts): FlowCond[] | null {
  if (i === 0 || s.kind !== "review" || !s.when || stepApplies(s, facts)) return null;
  // CR-121 D-0 · nhóm lồng ⇒ trải phẳng các điều kiện lá không thỏa (thẻ chỉ liệt kê điều kiện lá).
  return s.when.conds.flatMap((c) =>
    "field" in c ? (condHolds(c, facts) ? [] : [c]) : c.conds.filter((x) => !condHolds(x, facts)),
  );
}

/** Các bước người dùng của mẫu chụp ghép với stage engine cùng khoá (thiếu stage ⇒ `pending`). */
export function cardSteps(
  flow: readonly FlowStep[],
  sv: EngineStepsView | null,
  facts: FlowFacts,
  x: CardExtras = {},
): CardStep[] {
  const byKey = new Map((sv?.steps ?? []).map((s) => [s.key, s]));
  const own = flow.filter((s): s is FlowEngineStep => s.kind !== "esign"); // esign-flow · Ký số không là stage
  return own.map((s, i) => {
    const st = byKey.get(`s${i}`);
    const head = s.kind === "review";
    return {
      idx: i,
      key: s.key,
      name: s.name,
      kind: s.kind,
      status: st?.status ?? "pending",
      group_id: head ? s.department_group_id : null,
      head_only: head && s.head_only,
      escalated_group_id: st?.escalated_group_id ?? null,
      due_at: st?.due_at ?? null,
      escalated: st?.escalated ?? false,
      decided_by: st?.decided_by ?? null,
      decided_at: st?.decided_at ?? null,
      feedback: st?.feedback ?? null,
      skip_when: (st?.status ?? "pending") === "pending" ? willSkip(s, i, facts) : null,
      ...ownerFields(st, x),
    };
  });
}

/** Bước đang mở (stage `s<i>` mở) — bước người dùng đầu tiên có trạng thái `open`. */
export function openStep(steps: readonly CardStep[]): CardStep | null {
  return steps.find((s) => s.status === "open") ?? null;
}

/** `step` của thẻ (enum HD3) theo trạng thái lượt duyệt. */
export function cardStepOf(status: string) {
  if (status === "extracting") return "extract" as const;
  if (status === "level1" || status === "level2") return "level1" as const;
  if (status === "done" || status === "rejected" || status === "cancelled") return status;
  return status === "failed" ? ("cancelled" as const) : null;
}

export type EngineCardInput = {
  approval: {
    id: string;
    status: string;
    startedBy: string;
    feedback: string | null;
    /** CR-107 · run đang gắn; `null` ⇒ lượt kẹt chưa có run; vắng ⇒ không biết (coi như có run). */
    engineRunId?: string | null;
  };
  flow: readonly FlowStep[];
  facts: FlowFacts;
  sv: EngineStepsView | null;
  viewerId: string;
  /** CR-113 · vắng ⇒ không có `decided_as`/`overdue`/`escalated_to`. */
  extras?: CardExtras;
};

/** Lý do người xem không quyết được bước mở: người bắt đầu ở bước `exclude_starter` ⇒ `starter`, còn lại `not_reviewer`. */
export function blockReasonOf(flow: readonly FlowStep[], idx: number, starter: string, me: string) {
  const s = flow[idx];
  return s?.kind === "review" && s.exclude_starter && starter === me
    ? ("starter" as const)
    : ("not_reviewer" as const);
}

/** CR-107 · lượt `level1`: run `needs_decision` ⇒ lý do + lúc mở quyết định của engine; run đã kết thúc bất thường / lượt kẹt chưa có
 *  run ⇒ `stalled` + lý do đã ghi ở lượt (`feedback`, vd `ENGINE_RUN_FAILED`, `FLOW_GROUP_MISSING:<mã>`); còn lại ⇒ null. */
export function attentionOf(i: EngineCardInput): EngineAttention | null {
  if (i.approval.status !== "level1") return null;
  const sv = i.sv;
  if (sv?.status === "needs_decision")
    return {
      kind: "needs_decision",
      reason: sv.decision?.reason ?? null,
      since: sv.decision?.at ?? null,
    };
  const noRun = i.approval.engineRunId === null;
  if (noRun || (sv !== null && isTerminalRun(sv.status)))
    return { kind: "stalled", reason: i.approval.feedback, since: null };
  return null;
}

/** Thẻ duyệt `mode = 'engine'` (hình dạng `ContractApproval` + `mode` + `steps`). */
export function engineCardView(i: EngineCardInput) {
  const steps = cardSteps(i.flow, i.sv, i.facts, i.extras);
  const open = openStep(steps);
  const task = open ? (i.sv?.steps.find((s) => s.key === `s${open.idx}`)?.task ?? null) : null;
  const can = task?.can_act === true;
  const live = i.approval.status === "level1";
  const attention = attentionOf(i);
  return {
    mode: "engine" as const,
    run_id: i.approval.id,
    run_status: i.sv?.status ?? null,
    step: cardStepOf(i.approval.status),
    task_id: live && task ? task.id : null,
    can_act: live && can,
    feedback: i.approval.feedback,
    block_reason:
      live && open && task && !can
        ? blockReasonOf(i.flow, open.idx, i.sv?.started_by ?? i.approval.startedBy, i.viewerId)
        : null,
    finalizes_on_approve:
      live && can && open ? finalizesOnApprove(i.flow, i.facts, open.idx) : false,
    /** Run đã kết thúc mà lượt còn `level1` (huỷ ngoài luồng / lỗi) hoặc lượt kẹt chưa có run: chờ owner/admin "Mở lại quy trình". */
    needs_reopen: attention?.kind === "stalled",
    attention,
    steps,
  };
}

export type EngineAction = "approve" | "reject" | "redo" | "return";
export type EngineErrorCode =
  | "APPROVAL_NOT_OPEN"
  | "NOT_REVIEWER"
  | "STARTER_CANNOT_REVIEW"
  | "FEEDBACK_REQUIRED";
export type EnginePlan =
  | { kind: "error"; code: EngineErrorCode }
  | { kind: "pass"; taskId: string; finalizes: boolean }
  | { kind: "fail_back"; taskId: string }
  | { kind: "reject"; taskId: string }
  | { kind: "redo"; taskId: string; reextract: boolean };

const hasText = (s: string | null | undefined) => typeof s === "string" && s.trim() !== "";
const err = (code: EngineErrorCode): EnginePlan => ({ kind: "error", code });

/** Hành động ⇒ kế hoạch (đã kiểm: bước mở có task, quyền `can_act`, lý do, Trả lại không ở bước soạn). */
export function planEngineAct(
  i: EngineCardInput & {
    action: EngineAction;
    feedback: string | null | undefined;
    hasSource: boolean;
  },
): EnginePlan {
  const card = engineCardView(i);
  const open = openStep(card.steps);
  const task = open ? i.sv?.steps.find((s) => s.key === `s${open.idx}`)?.task : null;
  if (i.approval.status !== "level1" || !open || !task) return err("APPROVAL_NOT_OPEN");
  if (!task.can_act)
    return err(card.block_reason === "starter" ? "STARTER_CANNOT_REVIEW" : "NOT_REVIEWER");
  if (i.action !== "approve" && !hasText(i.feedback)) return err("FEEDBACK_REQUIRED");
  if (i.action === "approve")
    return { kind: "pass", taskId: task.id, finalizes: card.finalizes_on_approve };
  if (i.action === "reject") return { kind: "reject", taskId: task.id };
  if (i.action === "redo") return { kind: "redo", taskId: task.id, reextract: i.hasSource };
  return open.idx === 0 ? err("APPROVAL_NOT_OPEN") : { kind: "fail_back", taskId: task.id };
}
