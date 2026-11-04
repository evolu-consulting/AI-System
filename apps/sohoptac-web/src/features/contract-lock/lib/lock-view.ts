// CR-097 K3a · HD-FR-100 · HD-FR-104: luật thuần màn HĐ theo khoá — banner nào hiện, ô nào sửa được, ai được mở lại. Thuần.
import type { ContractDetail } from "@ai/contracts";
import type { TextKey } from "~/features/contract-form/lib/form-model";

export type LockBanner = "locked" | "pending" | null;

export type LockView = {
  banner: LockBanner;
  locked: boolean;
  /** Ô thông tin chỉ đọc khi khoá (tất cả). */
  lockedKeys: ReadonlySet<TextKey> | undefined;
  /** Owner gói hoặc người phụ trách (CR-101a) thấy link "Mở lại để sửa lỗi trích xuất". */
  canReopen: boolean;
  noDocument: boolean;
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

/** lock-strict (2026-10-23): sau khi khoá KHÔNG trường nào sửa được (cả `notice_days`). */
export const LOCKED_LEGAL_KEYS: ReadonlySet<TextKey> = new Set(ALL_KEYS);

/** CR-101a (Câu 6): link "Mở lại" cho owner gói HOẶC người phụ trách HĐ (có quyền ghi) — khớp luật server `canReopen`. */
export const reopenRight = (
  c: Pick<ContractDetail, "owner_user_id">,
  me: { owner: boolean; write: boolean; userId: string | null | undefined },
): boolean => me.owner || (me.write && !!me.userId && c.owner_user_id === me.userId);

export function lockView(
  c: Pick<ContractDetail, "locked" | "status" | "has_document">,
  owner: boolean,
): LockView {
  const banner: LockBanner = c.locked ? "locked" : c.status === "needs_review" ? "pending" : null;
  return {
    banner,
    locked: c.locked,
    lockedKeys: c.locked ? LOCKED_LEGAL_KEYS : undefined,
    canReopen: c.locked && owner,
    noDocument: !c.has_document,
  };
}

/** Lỗi API của đường khoá ⇒ khoá i18n (null = để nơi gọi dùng câu chung). */
export function lockErrorKey(status: number | undefined, code: string | undefined): string | null {
  if (code === "CONTRACT_LOCKED") return "contracts.lock.errLocked";
  if (code === "CONTRACT_NOT_LOCKED") return "contracts.lock.errNotLocked";
  if (code === "USE_VERSIONS") return "contracts.lock.errUseVersions";
  if (status === 403) return "contracts.lock.errForbidden";
  return null;
}
