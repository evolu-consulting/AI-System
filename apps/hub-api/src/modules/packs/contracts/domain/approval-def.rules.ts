// HD-FR-33 · HD-FR-37 · D3-02/D3-12 · M3-decouple: luật duyệt theo tenant (ngưỡng cấp 2 + Group cấp 1/cấp 2) và luật rẽ cấp 2.
// Thuần (lớp 1). Ngưỡng là cài đặt tenant đọc lúc chạy (không hằng); giá trị đọc là `total_value` HIỆN TẠI (sau sửa tay).

/** Mặc định khi tenant chưa lưu cài đặt — nguồn: spec HD3 §5 (người dùng chốt 2026-10-19: ngưỡng 500 tr, editor cấp 1, owner cấp 2). */
export const APPROVAL_DEFAULTS = {
  threshold: 500_000_000,
  level1GroupKey: "contracts-editor",
  level2GroupKey: "contracts-owner",
} as const;
/** prod-fix2 · Group vai owner của gói (= quyền gói `admin`, "Toàn quyền") — quyết được mọi bước duyệt trên engine. */
export const PACK_OWNER_GROUP_KEY = "contracts-owner";
export type ApprovalSettings = {
  threshold: number;
  level1GroupKey: string;
  level2GroupKey: string;
};
export const APPROVAL_THRESHOLD_MAX = 1_000_000_000_000_000;

/** `total_value ≥ ngưỡng` ⇒ cấp 2; trống / không phải số hữu hạn / âm ⇒ cấp 2 (an toàn, intake câu 1). */
export function needsLevel2(total: unknown, threshold: number): boolean {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return true;
  return total >= threshold;
}

/** Bước hiển thị của thẻ duyệt (contract `ContractApproval.step`). */
export type ApprovalStep =
  | "extract"
  | "level1"
  | "value"
  | "level2"
  | "finalize"
  | "done"
  | "rejected"
  | "cancelled";
