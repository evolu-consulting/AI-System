// HD-FR-36 · S05: luật hiển thị thẻ duyệt (thuần). "Xác nhận" (cấp 1, như mgmt-app `ContractPage.tsx:102`) / "Duyệt" (cấp 2) /
// "Từ chối" / "Đọc lại" chỉ khi engine báo `can_act`; đang chờ bước mà người xem không quyết được ⇒ một dòng ghi chú.

import type { FlowActionRequest } from "@ai/contracts/flow";
import type { ApprovalActionRequest, ContractApproval } from "@ai/contracts/pack-contracts";
import type { ApprovalView } from "./approval-view";
import { engineApprovalView, submittedForReview } from "./engine-card";

export type { ApprovalView };

const NONE: ApprovalView = {
  confirm: false,
  approve: false,
  reject: false,
  redo: false,
  note: null,
};

/** p24 · vừa "Xác nhận và lưu" thành công mà thẻ trên màn còn là bản máy cũ (chưa tải lại) ⇒ nút Xác nhận/Từ chối/Đọc lại đã hết nghĩa. */
export const staleAfterConfirm = (a: ContractApproval | undefined, confirmed: boolean): boolean =>
  confirmed && a?.mode !== "engine";

/** Đã gửi duyệt (lượt engine qua bước soạn) HOẶC vừa xác nhận mà thẻ còn bản cũ. */
export const submittedAfter = (a: ContractApproval | undefined, confirmed: boolean): boolean =>
  staleAfterConfirm(a, confirmed) || submittedForReview(a);

/** CR-123 U2 · người xem đang có nút quyết (Duyệt / Xác nhận) ⇒ dòng "bước kế" của thẻ nói "Bạn cần…". */
export const canDecide = (v: ApprovalView): boolean => v.pass === true || v.approve || v.confirm;

/**
 * CR-125 · UX H4 · người duyệt đúng nghĩa: đang có nút quyết (Duyệt/Đạt) ở bước KHÔNG phải xác nhận của người tạo, HĐ không còn
 * ở bước chờ xác nhận sau upload ⇒ trang hiện thẻ tóm tắt + nút thay vì cả form sửa.
 */
export const decideOnly = (v: ApprovalView, status: string): boolean =>
  canDecide(v) && !v.confirm && status !== "needs_review";

/** p24 · nút theo thẻ, trừ khi vừa xác nhận mà thẻ còn bản cũ (khi đó không còn nút nào). */
export const viewAfterConfirm = (
  a: ContractApproval | undefined,
  confirmed: boolean,
  o: { write: boolean; hasSource: boolean },
): ApprovalView => (staleAfterConfirm(a, confirmed) ? NONE : approvalView(a, o));

/** Ghi chú khi người xem không quyết được bước đang mở: nói rõ VÌ SAO (chỉ xem / không thuộc nhóm duyệt / người gửi). */
function blockedNote(step: "level1" | "level2", a: ContractApproval, write: boolean): string {
  if (!write) return "contracts.approval.blocked.viewOnly";
  if (a.block_reason === "starter") return "contracts.approval.blocked.starter";
  if (a.block_reason === "not_reviewer") return `contracts.approval.blocked.notReviewer.${step}`;
  return step === "level1" ? "contracts.approval.waitLevel1" : "contracts.approval.waitLevel2";
}

export function approvalView(
  a: ContractApproval | undefined,
  o: { write: boolean; hasSource: boolean },
): ApprovalView {
  if (!a?.step) return NONE;
  if (a.mode === "engine") return engineApprovalView(a, o);
  const act = o.write && a.can_act;
  if (a.step === "level1")
    return act
      ? { confirm: true, approve: false, reject: true, redo: o.hasSource, note: null }
      : { ...NONE, note: blockedNote("level1", a, o.write) };
  if (a.step === "level2")
    return act
      ? { confirm: false, approve: true, reject: true, redo: false, note: null }
      : { ...NONE, note: blockedNote("level2", a, o.write) };
  if (a.step === "extract" || a.step === "value" || a.step === "finalize")
    return { ...NONE, note: "contracts.approval.working" };
  return NONE;
}

/** ux-excel E4: ở bước "Xác nhận" (cấp 1) header chỉ còn nút chính "Xác nhận và lưu"; "Từ chối" gom vào menu "⋯".
 *  confirm-flow (người dùng 2026-10-23): "Đọc lại" (trích lại kèm lý do) ẩn — chỉ còn "AI đọc lại từ đầu" ở khối Quản lý. */
export const overflowOf = (v: ApprovalView): "reject"[] =>
  v.confirm && v.reject ? ["reject"] : [];

/** CR-120 · thân thẻ duyệt ⇒ đầu vào `FlowRuntime.act`: lý do = `feedback`, SP gắn (products-confirm) = `extension` của gói. */
export function flowActionOf(b: ApprovalActionRequest): FlowActionRequest {
  return {
    ...(b.feedback !== undefined ? { feedback: b.feedback } : {}),
    ...(b.products !== undefined ? { extension: b.products } : {}),
  };
}

/** Kết quả một lần quyết bước duyệt (hook `useApproval.act`). */
export type ActResult = { ok: true; step: string | null } | { ok: false; code: string | null };

/** confirm-flow: sau "Xác nhận" trong hộp "Gắn sản phẩm" — thành công (mọi bước) ⇒ đóng hộp + tải lại; cấp 1 chuyển cấp 2 ⇒ báo chờ
 *  Ban giám đốc. Bước không còn mở (đua / đã đọc lại) ⇒ đóng hộp, tải lại, câu rõ ràng (không kẹt hộp). Lỗi khác ⇒ giữ hộp để thử lại. */
export function afterConfirm(r: ActResult): {
  close: boolean;
  refetch: boolean;
  toast: string | null;
} {
  if (r.ok)
    return {
      close: true,
      refetch: true,
      toast: r.step === "level2" ? "contracts.approval.done.toLevel2" : null,
    };
  const gone = r.code === "APPROVAL_NOT_OPEN" || r.code === "REVIEW_TASK_CLOSED";
  return { close: gone, refetch: gone, toast: null };
}

/** Nút "Lưu nháp" thứ cấp chỉ hiện khi người xem KHÔNG xác nhận được (còn lại "Xác nhận và lưu" đã lưu trước). */
export const showDraftSave = (v: ApprovalView, canSave: boolean): boolean => canSave && !v.confirm;

/** products-confirm: hộp "Gắn sản phẩm" chỉ khi máy chủ báo bước này sẽ xác nhận HĐ (hub cũ không báo ⇒ không hộp) và HĐ có dòng. */
export const showLinkDialog = (a: ContractApproval | undefined, items: number): boolean =>
  a?.finalizes_on_approve === true && items > 0;

/** Lý do Từ chối / Đọc lại: bắt buộc, ≤ 4.000 ký tự (cùng luật engine `FEEDBACK_REQUIRED`). */
export const feedbackOk = (s: string): boolean => s.trim().length > 0 && s.length <= 4000;
