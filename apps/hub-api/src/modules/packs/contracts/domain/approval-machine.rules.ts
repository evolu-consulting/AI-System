// M3-decouple · HD-FR-31…36 · D3-02/D3-07/D3-08/D3-13: máy trạng thái duyệt HĐ trong gói (thay run engine). Thuần (lớp 1).
//   extracting ─(AI đọc xong)→ level1 ─(Xác nhận, giá trị < ngưỡng)→ done
//                               level1 ─(Xác nhận, ≥ ngưỡng/trống)→ level2 ─(Duyệt, KHÔNG phải người bắt đầu)→ done
//   level1|level2 ─(Từ chối + lý do)→ rejected · ─(Trích lại + lý do)→ extracting (có nguồn) · AI lỗi ⇒ failed
// Cấp 1: Group cấp 1 (người bắt đầu ĐƯỢC — intake câu 5). Cấp 2: Group cấp 2, người bắt đầu bị chặn MỌI thao tác (D3-08).
import { needsLevel2 } from "./approval-def.rules";

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
export const LIVE_APPROVAL: ReadonlySet<string> = new Set(["extracting", "level1", "level2"]);

export type ApprovalActionKind = "approve" | "reject" | "redo";
export type ApprovalActor = { userId: string; inLevel1: boolean; inLevel2: boolean };
export type ApprovalErrorCode =
  | "APPROVAL_NOT_OPEN"
  | "NOT_REVIEWER"
  | "STARTER_CANNOT_REVIEW"
  | "FEEDBACK_REQUIRED";

export type DecideInput = {
  status: string;
  startedBy: string;
  actor: ApprovalActor;
  action: ApprovalActionKind;
  feedback: string | null | undefined;
  /** `total_value` HIỆN TẠI của HĐ (D3-02). */
  value: unknown;
  threshold: number;
  hasSource: boolean;
};
export type Decision =
  | { kind: "error"; code: ApprovalErrorCode }
  | { kind: "to_level2" }
  | { kind: "finalize"; level2Passed: boolean }
  | { kind: "reject" }
  | { kind: "redo"; reextract: boolean };

const isOpen = (s: string): s is "level1" | "level2" => s === "level1" || s === "level2";
const hasText = (s: string | null | undefined) => typeof s === "string" && s.trim() !== "";

/** Người được quyết bước đang mở (thẻ duyệt `can_act`). */
export function canAct(status: string, startedBy: string, a: ApprovalActor): boolean {
  if (status === "level1") return a.inLevel1;
  if (status === "level2") return a.inLevel2 && a.userId !== startedBy;
  return false;
}

export function decide(i: DecideInput): Decision {
  if (!isOpen(i.status)) return { kind: "error", code: "APPROVAL_NOT_OPEN" };
  if (i.status === "level2" && i.actor.userId === i.startedBy)
    return { kind: "error", code: "STARTER_CANNOT_REVIEW" };
  if (!(i.status === "level1" ? i.actor.inLevel1 : i.actor.inLevel2))
    return { kind: "error", code: "NOT_REVIEWER" };
  if (i.action !== "approve" && !hasText(i.feedback))
    return { kind: "error", code: "FEEDBACK_REQUIRED" };
  if (i.action === "reject") return { kind: "reject" };
  if (i.action === "redo") return { kind: "redo", reextract: i.hasSource };
  if (i.status === "level2") return { kind: "finalize", level2Passed: true };
  return needsLevel2(i.value, i.threshold)
    ? { kind: "to_level2" }
    : { kind: "finalize", level2Passed: false };
}

/** Kết cục lượt AI đọc ⇒ trạng thái lượt duyệt (HĐ `needs_review` ⇒ cấp 1; lỗi ⇒ failed). */
export function afterExtraction(contractStatus: string): "level1" | "failed" | null {
  if (contractStatus === "needs_review") return "level1";
  if (contractStatus === "extract_failed") return "failed";
  return null;
}

/** Giai đoạn cho luật sửa trường (`approval-edit.rules`): cấp 1 (gồm đang đọc) sửa được; cấp 2 khoá. */
export function phaseOf(status: string | null): "none" | "level1" | "later" {
  if (status === "extracting" || status === "level1") return "level1";
  if (status === "level2") return "later";
  return "none";
}

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

/** products-confirm: "Xác nhận/Duyệt" của người xem sẽ làm HĐ thành "đã xác nhận" (cấp 2; hoặc cấp 1 khi giá trị HIỆN TẠI < ngưỡng)
 *  ⇒ màn hình mở hộp "Gắn sản phẩm". Bước đóng / không quyết được / thiếu giá trị (cần cấp 2) ⇒ false. */
export function finalizesOnApprove(
  status: string,
  can: boolean,
  price: { value: unknown; threshold: number } | undefined,
): boolean {
  if (!can) return false;
  if (status === "level2") return true;
  return status === "level1" && price !== undefined && !needsLevel2(price.value, price.threshold);
}

/** Thẻ duyệt (contract `ContractApproval`, giữ nguyên hình dạng HD3). `price` = giá trị HĐ + ngưỡng (vắng ⇒ cấp 1 coi như chưa xác
 *  nhận ngay). */
export function approvalView(
  a: { id: string; status: string; startedBy: string; feedback: string | null } | null,
  actor: ApprovalActor,
  price?: { value: unknown; threshold: number },
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
  const can = canAct(s, a.startedBy, actor);
  return {
    run_id: a.id,
    run_status: RUN_STATUS[s],
    step: STEP[s],
    task_id: isOpen(s) ? a.id : null,
    can_act: can,
    feedback: a.feedback,
    block_reason: isOpen(s) && !can ? blockReason(s, a.startedBy, actor) : null,
    finalizes_on_approve: finalizesOnApprove(s, can, price),
  };
}

/** Vì sao không quyết được bước đang mở: người gửi ở cấp 2 (dù thuộc Group 2) ⇒ `starter`; còn lại ⇒ `not_reviewer`. */
function blockReason(s: "level1" | "level2", startedBy: string, a: ApprovalActor) {
  return s === "level2" && a.inLevel2 && a.userId === startedBy
    ? ("starter" as const)
    : ("not_reviewer" as const);
}
