// HD-FR-26 · S05 · D-02: luật thuần màn HĐ — cảnh báo của luật (`warnings` của chi tiết là `unknown[]` ở contract đọc) và dòng phụ dưới tiêu đề.
// V2-F: ô thông tin ↔ `fields` chuyển sang `contract-form/lib/detail-form.ts`.
import type { ContractDetail, ContractWarning } from "@ai/contracts";

/** `warnings` của chi tiết là `unknown[]` ở contract đọc (HD1) — lấy phần có `message` chuỗi. */
export function warningsOf(c: Pick<ContractDetail, "warnings">): ContractWarning[] {
  return c.warnings.filter(
    (w): w is ContractWarning =>
      typeof w === "object" &&
      w !== null &&
      typeof (w as { message?: unknown }).message === "string",
  );
}

/** Dòng phụ dưới tiêu đề theo trạng thái (`ContractPage.tsx:93`). */
export function leadKey(status: string): string | null {
  if (status === "extracting") return "contracts.review.reading";
  if (status === "needs_review") return "contracts.review.checkLead";
  return null;
}
