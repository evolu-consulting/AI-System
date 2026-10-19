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

export function approvalView(
  a: ContractApproval | undefined,
  o: { write: boolean; hasSource: boolean },
): ApprovalView {
  if (!a?.step) return NONE;
  const act = o.write && a.can_act;
  if (a.step === "level1")
    return act
      ? { confirm: true, approve: false, reject: true, redo: o.hasSource, note: null }
      : { ...NONE, note: "contracts.approval.waitLevel1" };
  if (a.step === "level2")
    return act
      ? { confirm: false, approve: true, reject: true, redo: false, note: null }
      : { ...NONE, note: "contracts.approval.waitLevel2" };
  if (a.step === "extract" || a.step === "value" || a.step === "finalize")
    return { ...NONE, note: "contracts.approval.working" };
  return NONE;
}

/** Lý do Từ chối / Đọc lại: bắt buộc, ≤ 4.000 ký tự (cùng luật engine `FEEDBACK_REQUIRED`). */
export const feedbackOk = (s: string): boolean => s.trim().length > 0 && s.length <= 4000;
