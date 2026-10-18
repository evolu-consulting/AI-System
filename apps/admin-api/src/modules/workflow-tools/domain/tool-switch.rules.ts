// ADM-FR-73 · TT-R01, TT-R03 (plan-d2 §6) · lớp 1: công tắc tool theo tenant — thuần, chỉ built-in.

/** Công tắc của một workflow cho một tenant. Bật ⇔ có hàng `revoked_at IS NULL` (TT-R01). */
export type ToolSwitch = {
  workflowId: string;
  tenantId: string;
  on: boolean;
  grantedAt: Date | null;
  grantedBy: string | null;
};

export type ToggleWant = "on" | "off";
export type ToggleChange = "insert" | "reactivate" | "revoke" | "none";

/**
 * Việc cần ghi khi muốn bật/tắt: chưa có hàng + bật ⇒ `insert`; đã tắt + bật ⇒ `reactivate`; đang bật + tắt ⇒ `revoke`;
 * còn lại (đã đúng trạng thái, hoặc tắt khi chưa từng bật) ⇒ `none` — không ghi, không audit, không NOTIFY.
 */
export function toggleChange(
  cur: { revokedAt: Date | null } | null,
  want: ToggleWant,
): ToggleChange {
  if (want === "on") {
    if (cur === null) return "insert";
    return cur.revokedAt === null ? "none" : "reactivate";
  }
  return cur !== null && cur.revokedAt === null ? "revoke" : "none";
}

/** Bật/tắt sau khi đổi: `insert`/`reactivate` ⇒ bật; `revoke` ⇒ tắt; `none` ⇒ giữ trạng thái hiện tại. */
export function isOnAfter(cur: { revokedAt: Date | null } | null, change: ToggleChange): boolean {
  if (change === "insert" || change === "reactivate") return true;
  if (change === "revoke") return false;
  return cur !== null && cur.revokedAt === null;
}
