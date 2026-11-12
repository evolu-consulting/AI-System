// CR-127 · U4 · BR-27…34 · nhận việc nhóm: luật thuần của dải «Nhận việc / Trả về nhóm / {X} đang xử lý / x/n / Thay A».
// Nhãn nguyên văn spec §8 (#65). Server là chỗ quyết cuối; ở đây chỉ quyết nút nào hiện + vì sao nút quyết bị khoá.
import type { TaskClaim, TaskVotes } from "@ai/contracts/chat";

export type ClaimInfo = {
  claim?: TaskClaim | undefined;
  need?: "one" | "head" | "all" | undefined;
  votes?: TaskVotes | undefined;
  delegated_from?: { id: string; display_name: string } | undefined;
  /** U4b-1 · hub tính (một luật với `POST /reassign`): chỉ `true` mới hiện «Chuyển cho…». */
  can_reassign?: boolean | undefined;
};

export type ClaimView = {
  /** Cần nhận việc mới quyết được (việc nhóm `need ≠ all`, chưa ai nhận hoặc mình giữ). */
  claimable: boolean;
  state: "none" | "unclaimed" | "mine" | "other";
  /** Nút «Nhận việc» / «Trả về nhóm». */
  canClaim: boolean;
  canRelease: boolean;
  canReassign: boolean;
  /** Khoá nút Duyệt/Trả lại/Từ chối: người khác đang giữ, hoặc chưa nhận. */
  decideLocked: "unclaimed" | "other" | null;
  /** Tên người đang giữ (khi `other`). */
  holder: string | null;
  votesText: string | null;
  onBehalfOf: string | null;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U4 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
export function claimView(i: ClaimInfo): ClaimView {
  const state = i.claim?.state ?? "none";
  // `Cần: tất cả` không có nhận việc (mọi người cùng bỏ phiếu) — chỉ hiện x/n.
  const claimable = state !== "none" && i.need !== "all";
  const mine = claimable && state === "mine";
  return {
    claimable,
    state: claimable ? state : "none",
    canClaim: claimable && state === "unclaimed",
    canRelease: mine,
    canReassign: claimable && i.can_reassign === true,
    decideLocked: !claimable
      ? null
      : state === "unclaimed"
        ? "unclaimed"
        : state === "other"
          ? "other"
          : null,
    holder: state === "other" ? (i.claim?.by?.display_name ?? null) : null,
    votesText: i.need === "all" && i.votes ? `${i.votes.done}/${i.votes.total}` : null,
    onBehalfOf: i.delegated_from?.display_name ?? null,
  };
}

/** Mã lỗi nhận việc/uỷ quyền/bằng chứng ⇒ khoá i18n + tham số (§9). `null` = không phải mã của lát này. */
export const CR127_ERROR_CODES = [
  "TASK_CLAIMED",
  "STARTER_CANNOT_REVIEW",
  "TASK_NOT_CLAIMABLE",
  "TASK_CLOSED",
  "TASK_NOT_CLAIMED",
  "NOT_CLAIMER",
  "NOT_GROUP_HEAD",
  "TARGET_NOT_IN_GROUP",
  "FORWARD_REASON_REQUIRED",
  "DELEGATE_SELF",
  "DELEGATE_CHAIN",
  "DELEGATE_NOT_SIGNER",
  "DELEGATE_NO_ACCESS",
  "DELEGATE_FORBIDDEN",
  "EVIDENCE_REQUIRED",
  "FEEDBACK_REQUIRED",
  "CLAIM_HOURS_RANGE",
  "INBOX_NOT_AWAITING",
  "INBOX_DECISION_FORBIDDEN",
  "SIGNER_GROUP_INVALID",
  "PARTNER_OWNER_INVALID",
] as const;

export function cr127ErrorKey(code: string | undefined): string | null {
  return code && (CR127_ERROR_CODES as readonly string[]).includes(code)
    ? `contracts.work.u4.err.${code}`
    : null;
}

/** Tên người từ `details.by` (chuỗi hoặc `{display_name}`); thiếu ⇒ «người khác». */
export function whoOf(details: unknown, fallback: string): string {
  const by = (details as { by?: unknown } | undefined)?.by;
  if (typeof by === "string" && by !== "") return by;
  const n = (by as { display_name?: unknown } | undefined)?.display_name;
  return typeof n === "string" && n !== "" ? n : fallback;
}
