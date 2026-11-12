// CR-127 · Z1 (BR-78) · lượt của HĐ trong `contracts.approvals`: trạng thái lượt + thẻ duyệt của lượt ĐỌC AI. Máy duyệt 2 bước cũ
// (`decide`, cấp 1/cấp 2, ngưỡng giá trị) đã gỡ — quyết duyệt chỉ chạy trên engine (`mode = 'engine'`, thẻ ở `approval-engine-card`).
// Lượt `mode = 'machine'` còn lại CHỈ là bản ghi theo dõi lượt AI đọc (`extracting` → `failed`/`cancelled`); không còn cấp 1/cấp 2.
// Thuần (lớp 1).

export const APPROVAL_STATUSES = [
  "extracting",
  "level1",
  "level2",
  "done",
  "rejected",
  "cancelled",
  "failed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
/** Lượt đang sống (chỉ mục duy nhất `approvals_live_uq` — một lượt sống mỗi HĐ). */
export const LIVE_APPROVAL: ReadonlySet<string> = new Set(["extracting", "level1", "level2"]);

export type ApprovalErrorCode =
  | "APPROVAL_NOT_OPEN"
  | "NOT_REVIEWER"
  | "STARTER_CANNOT_REVIEW"
  | "FEEDBACK_REQUIRED";

const STEP: Record<
  ApprovalStatus,
  "extract" | "level1" | "level2" | "done" | "rejected" | "cancelled"
> = {
  extracting: "extract",
  level1: "level1",
  level2: "level2",
  done: "done",
  rejected: "rejected",
  cancelled: "cancelled",
  failed: "cancelled",
};
const RUN_STATUS: Record<ApprovalStatus, string> = {
  extracting: "running",
  level1: "waiting_review",
  level2: "waiting_review",
  done: "done",
  rejected: "cancelled",
  cancelled: "cancelled",
  failed: "failed",
};

/** Thẻ của lượt không chạy trên engine (lượt đọc AI): chỉ hiển thị, không ai quyết được (`can_act` luôn false). */
export function approvalView(
  a: { id: string; status: string; startedBy: string; feedback: string | null } | null,
) {
  if (!a || !(APPROVAL_STATUSES as readonly string[]).includes(a.status))
    return {
      run_id: a?.id ?? null,
      run_status: null,
      step: null,
      task_id: null,
      can_act: false,
      feedback: null,
      block_reason: null,
      finalizes_on_approve: false,
    };
  const s = a.status as ApprovalStatus;
  return {
    run_id: a.id,
    run_status: RUN_STATUS[s],
    step: STEP[s],
    task_id: null,
    can_act: false,
    feedback: a.feedback,
    block_reason: null,
    finalizes_on_approve: false,
  };
}
