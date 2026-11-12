// CR-127 · U5 · BR-35…42: luật thuần "khoá" của màn HĐ. Chỉ DRAFT là form; PROCESSING/DONE (khoá nội dung, tự động) và REJECT hiện dạng chữ đọc.
// Tạm khoá thực hiện (`hold`) là chip riêng, KHÔNG khoá nội dung. "Mở lại" đã gỡ — sửa sau DONE đi qua "Tải phiên bản mới".
import type { ContractStatus } from "@ai/contracts/pack-contracts";
import type { TextKey } from "~/features/contract-form/lib/form-model";

export type LockView = {
  /** Nội dung khoá (không ô nhập, chỉ chữ đọc). */
  locked: boolean;
  /** Ô thông tin chỉ đọc khi khoá (tất cả). */
  lockedKeys: ReadonlySet<TextKey> | undefined;
};

const ALL_KEYS: readonly TextKey[] = [
  "title",
  "number",
  "partner_name",
  "partner_tax_id",
  "partner_signer",
  "our_signer",
  "start_date",
  "end_date",
  "notice_days",
  "total_value",
  "payment_terms",
  "commission_pct",
  "commission_fixed",
];

/** Khoá nội dung: không trường nào sửa được (cả `notice_days`). */
export const LOCKED_LEGAL_KEYS: ReadonlySet<TextKey> = new Set(ALL_KEYS);

/** Chỉ DRAFT là form; mọi trạng thái khác là chữ đọc. */
export const contentLocked = (status: ContractStatus): boolean => status !== "draft";

export function lockView(c: { status: ContractStatus }): LockView {
  const locked = contentLocked(c.status);
  return { locked, lockedKeys: locked ? LOCKED_LEGAL_KEYS : undefined };
}

/** Lỗi API của đường khoá ⇒ khoá i18n (null = để nơi gọi dùng câu chung). */
export function lockErrorKey(status: number | undefined, code: string | undefined): string | null {
  if (code === "CONTRACT_LOCKED") return "contracts.lock.errLocked";
  if (code === "USE_NEW_VERSION") return "contracts.u5.err.USE_NEW_VERSION";
  if (status === 403) return "contracts.lock.errForbidden";
  return null;
}
