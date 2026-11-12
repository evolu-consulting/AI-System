// HD-FR-26 · S05 · D-02: luật thuần màn HĐ — cảnh báo của luật (`warnings` của chi tiết là `unknown[]` ở contract đọc) và dòng phụ dưới tiêu đề.
// V2-F: ô thông tin ↔ `fields` chuyển sang `contract-form/lib/detail-form.ts`.
import type { ContractDetail, ContractWarning } from "@ai/contracts/pack-contracts";

/** `warnings` của chi tiết là `unknown[]` ở contract đọc (HD1) — lấy phần có `message` chuỗi. */
export function warningsOf(c: Pick<ContractDetail, "warnings">): ContractWarning[] {
  return c.warnings.filter(
    (w): w is ContractWarning =>
      typeof w === "object" &&
      w !== null &&
      typeof (w as { message?: unknown }).message === "string",
  );
}

/** Nút Lưu: chờ xác nhận ⇒ "Lưu nháp" (lưu chưa phải xác nhận). */
export const saveLabelKey = (confirm: boolean): string =>
  confirm ? "contracts.review.saveDraft" : "contracts.cform.saveChanges";

/** Thông báo sau khi lưu thành công; chỉ HĐ vừa chuyển sang hiệu lực mới được báo "có hiệu lực". */
export function savedNoticeKey(status: string, becameActive: boolean): string {
  if (becameActive) return "contracts.cform.reviewSavedActive";
  return status === "draft" ? "contracts.review.savedDraft" : "contracts.review.saved";
}
