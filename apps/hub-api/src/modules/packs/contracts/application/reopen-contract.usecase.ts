// CR-097 K1 · HD-FR-104: mở lại HĐ đã khoá — về "Chờ duyệt" (`needs_review`), bỏ khoá + "Đã duyệt", ghi log `reopened`
// (lý do, trạng thái trước, người, lúc) trong `contract_events` (lịch sử HĐ). Tenant bật duyệt ⇒ mở lượt duyệt mới ở cấp 1 (người mở
// lại = người bắt đầu) để duyệt lại; tắt duyệt ⇒ editor bấm "Xác nhận" lần nữa. Xác nhận lại ⇒ khoá lại (trigger DB 0048).
// CR-101a (Câu 6): người được mở lại = người phụ trách HĐ HOẶC owner gói (`admin`). Route chặn `write` trước; `admin` tính ở route
// (cache quyền, 0 SQL); người phụ trách kiểm TRONG câu SQL (khoá hàng). Không được phép ⇒ `forbidden` (403), không ghi gì.
// HĐ không thấy / tenant khác ⇒ 404. MỘT tx, 2 câu cố định.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { canReopen, reopenReasonOk, reopenVerdict } from "../domain/lock.rules";

export type ReopenOutcome =
  | { kind: "ok"; version: number }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "not_locked" }
  | { kind: "draft_exists" }
  | { kind: "reason_invalid" };

export type ReopenRepo = {
  /** MỘT câu (CTE): khoá hàng FOR UPDATE ⇒ (nếu đang khoá và `admin` ∨ người phụ trách) mở lượt duyệt khi tenant bật duyệt +
   *  UPDATE + event `reopened` (CR-121 Q-3: `byPlatform` ⇒ event ghi thêm `by_platform: true`). Đua/bấm 2 lần: khoá hàng + điều
   *  kiện `locked` trong cùng câu ⇒ chỉ một lần ra "ok", lần sau "not_locked". */
  reopen(
    id: string,
    reason: string,
    actor: string,
    admin: boolean,
    byPlatform?: boolean,
  ): Promise<ReopenRepoOut>;
};
export type ReopenRepoOut = {
  found: boolean;
  locked: boolean;
  version: number | null;
  /** CR-097 K2: chuỗi đang có nháp cập nhật ⇒ không mở lại. */
  draft?: boolean;
  /** CR-101a: người phụ trách HĐ (`owner_user_id`). */
  owner?: string | null;
};

export type ReopenContract = (
  who: PackWho,
  id: string,
  reason: string,
  /** `role` = vai trong JWT (route truyền; use case tự kiểm). */
  o?: { admin: boolean; role?: string },
) => Promise<ReopenOutcome>;

/** CR-121 Q-3: platform_admin chỉ hợp lệ khi route đã đặt tenant đích (`who.platform`); vai khác mà đòi `platform` ⇒ bỏ cờ. */
const isPlatform = (who: PackWho, o: { role?: string }) =>
  o.role === "platform_admin" && who.platform === true;

/** Kết quả repo + quyền ⇒ kết quả use case (thuần). Không được phép ⇒ `forbidden` TRƯỚC mọi kiểm khác. */
function outcomeOf(out: ReopenRepoOut, allowed: boolean): ReopenOutcome {
  const v = reopenVerdict({ locked: out.locked, allowed });
  if (v === "forbidden") return { kind: "forbidden" };
  if (out.draft && out.locked) return { kind: "draft_exists" };
  if (v === "not_locked" || out.version === null) return { kind: "not_locked" };
  return { kind: "ok", version: out.version };
}

export const reopenContract =
  (d: { uow: PackUow<KitTxRepos & { reopen: ReopenRepo }> }): ReopenContract =>
  async (who, id, reason, o = { admin: false }) => {
    const platform = isPlatform(who, o);
    // Platform_admin phải có lý do (≤ 500); vai khác giữ luật cũ (schema route chặn lý do rỗng).
    if (platform && !reopenReasonOk(reason)) return { kind: "reason_invalid" };
    // Cờ `platform` của `who` mà vai không phải platform_admin ⇒ không tin (mở tx theo user như thường).
    const scoped: PackWho = platform ? who : { ...who, platform: false };
    return d.uow.tenant(scoped, async (r): Promise<ReopenOutcome> => {
      const args = [id, reason.trim(), who.userId, o.admin || platform, platform] as const;
      const out = await r.reopen.reopen(...args);
      if (!out.found) return { kind: "not_found" };
      const owner = out.owner ?? null;
      const res = outcomeOf(out, canReopen({ admin: o.admin, platform, actor: who.userId, owner }));
      if (res.kind === "ok")
        await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return res;
    });
  };

// CR-121 Q-3 · audit thao tác của platform_admin trên lượt duyệt engine của một công ty, trong lịch sử HĐ (`contract_events`, chỉ thêm):
// (1) `intent` GHI TRƯỚC thao tác, fail-closed (không ghi được ⇒ không thao tác) ⇒ thao tác đã có hiệu lực thì luôn có dấu vết;
// (2) `result` ghi sau (kết quả). Cả hai: actor, tenant, HĐ, thao tác, lý do (intent). Scope tenant đích.
export type PlatformApprovalOp = "reopen" | "retry" | "cancel-reopen";

export type PlatformAuditRepo = {
  intent(c: { id: string; actor: string; op: PlatformApprovalOp; reason: string }): Promise<void>;
  result(c: { id: string; actor: string; op: PlatformApprovalOp; outcome: string }): Promise<void>;
};

export type PlatformOpAudit = {
  intent(who: PackWho, id: string, op: PlatformApprovalOp, reason: string): Promise<void>;
  result(who: PackWho, id: string, op: PlatformApprovalOp, outcome: string): Promise<void>;
};

export const platformOpAudit = (d: {
  uow: PackUow<{ audit: PlatformAuditRepo }>;
}): PlatformOpAudit => ({
  intent: (who, id, op, reason) =>
    d.uow.tenant(who, (r) => r.audit.intent({ id, actor: who.userId, op, reason })),
  result: (who, id, op, outcome) =>
    d.uow.tenant(who, (r) => r.audit.result({ id, actor: who.userId, op, outcome })),
});
