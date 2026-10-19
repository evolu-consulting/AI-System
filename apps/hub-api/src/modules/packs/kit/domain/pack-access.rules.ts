// PK-FR-05 · PK-AC05 · PK-AC06 · D-05 · D-11 · N1 plan §5: luật thuần quyền gói (lớp 1 — chỉ built-in, không import
// @ai/contracts: `PackAction` khớp `PACK_ACTIONS` của contract, adapter đối chiếu kiểu). Grant user lẻ KHÔNG là đầu vào (D-11).

export type PackAction = "read" | "write" | "admin";
/** Thứ tự trả về của `packActionsFor` (= `PACK_ACTIONS` contract). */
export const PACK_ACTION_ORDER: readonly PackAction[] = ["read", "write", "admin"];

export type PackAccessInput = {
  /** Tenant có entitlement `<k'>-read` còn hiệu lực. */
  entitled: boolean;
  /** Feature `<k'>-read` có `status='off'` (`beta` coi như `on`). */
  featureOff: boolean;
  userGroupIds: ReadonlySet<string>;
  /** Group được cấp mã cần kiểm (của tenant). */
  grantedGroupIds: readonly string[];
};
export type PackAccessResult = "ok" | "PACK_DISABLED" | "PACK_FORBIDDEN";

export type PackActionsInput = Omit<PackAccessInput, "grantedGroupIds"> & {
  grantedByAction: Readonly<Record<PackAction, readonly string[]>>;
};

const meets = (granted: readonly string[], user: ReadonlySet<string>): boolean =>
  granted.some((g) => user.has(g));

/** Chưa bật (thiếu entitlement read / feature off) ⇒ DISABLED (thắng FORBIDDEN); không Group nào giao ⇒ FORBIDDEN. */
export function checkPackAccess(i: PackAccessInput): PackAccessResult {
  if (!i.entitled || i.featureOff) return "PACK_DISABLED";
  return meets(i.grantedGroupIds, i.userGroupIds) ? "ok" : "PACK_FORBIDDEN";
}

/** `/me`: chưa bật ⇒ []; còn lại các việc có giao Group ≠ ∅, theo `PACK_ACTION_ORDER`. */
export function packActionsFor(i: PackActionsInput): PackAction[] {
  if (!i.entitled || i.featureOff) return [];
  return PACK_ACTION_ORDER.filter((a) => meets(i.grantedByAction[a], i.userGroupIds));
}
