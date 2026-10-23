// HD-FR-36 · S05: luật hiển thị thẻ duyệt (thuần). "Xác nhận" (cấp 1, như mgmt-app `ContractPage.tsx:102`) / "Duyệt" (cấp 2) /
// "Từ chối" / "Đọc lại" chỉ khi engine báo `can_act`; đang chờ bước mà người xem không quyết được ⇒ một dòng ghi chú.
import type { ContractApproval } from "@ai/contracts";

export type ApprovalView = {
  confirm: boolean;
  approve: boolean;
  reject: boolean;
  redo: boolean;
  /** Khoá i18n dòng ghi chú (null ⇒ không hiện). */
  note: string | null;
};

const NONE: ApprovalView = {
  confirm: false,
  approve: false,
  reject: false,
  redo: false,
  note: null,
};

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

/** ux-excel E4: ở bước "Xác nhận" (cấp 1) header chỉ còn nút chính "Xác nhận và lưu"; "Đọc lại" / "Từ chối" gom vào menu "⋯". */
export const overflowOf = (v: ApprovalView): ("redo" | "reject")[] =>
  v.confirm
    ? [...(v.redo ? (["redo"] as const) : []), ...(v.reject ? (["reject"] as const) : [])]
    : [];

/** Nút "Lưu nháp" thứ cấp chỉ hiện khi người xem KHÔNG xác nhận được (còn lại "Xác nhận và lưu" đã lưu trước). */
export const showDraftSave = (v: ApprovalView, canSave: boolean): boolean => canSave && !v.confirm;

/** products-confirm: hộp "Gắn sản phẩm" chỉ khi máy chủ báo bước này sẽ xác nhận HĐ (hub cũ không báo ⇒ không hộp) và HĐ có dòng. */
export const showLinkDialog = (a: ContractApproval | undefined, items: number): boolean =>
  a?.finalizes_on_approve === true && items > 0;

/** Lý do Từ chối / Đọc lại: bắt buộc, ≤ 4.000 ký tự (cùng luật engine `FEEDBACK_REQUIRED`). */
export const feedbackOk = (s: string): boolean => s.trim().length > 0 && s.length <= 4000;
