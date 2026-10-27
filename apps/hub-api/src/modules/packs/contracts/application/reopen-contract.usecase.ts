// CR-097 K1 · HD-FR-104: mở lại HĐ đã khoá — về "Chờ duyệt" (`needs_review`), bỏ khoá + "Đã duyệt", ghi log `reopened`
// (lý do, trạng thái trước, người, lúc) trong `contract_events` (lịch sử HĐ). Tenant bật duyệt ⇒ mở lượt duyệt mới ở cấp 1 (người mở
// lại = người bắt đầu) để duyệt lại; tắt duyệt ⇒ editor bấm "Xác nhận" lần nữa. Xác nhận lại ⇒ khoá lại (trigger DB 0048).
// CR-101a (Câu 6): người được mở lại = người phụ trách HĐ HOẶC owner gói (`admin`). Route chặn `write` trước; `admin` tính ở route
// (cache quyền, 0 SQL); người phụ trách kiểm TRONG câu SQL (khoá hàng). Không được phép ⇒ `forbidden` (403), không ghi gì.
// HĐ không thấy / tenant khác ⇒ 404. MỘT tx, 2 câu cố định.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { canReopen, reopenVerdict } from "../domain/lock.rules";

export type ReopenOutcome =
  | { kind: "ok"; version: number }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "not_locked" }
  | { kind: "draft_exists" };

export type ReopenRepo = {
  /** MỘT câu (CTE): khoá hàng FOR UPDATE ⇒ (nếu đang khoá và `admin` ∨ người phụ trách) mở lượt duyệt khi tenant bật duyệt +
   *  UPDATE + event `reopened`. */
  reopen(id: string, reason: string, actor: string, admin: boolean): Promise<ReopenRepoOut>;
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
  o?: { admin: boolean },
) => Promise<ReopenOutcome>;

export const reopenContract =
  (d: { uow: PackUow<KitTxRepos & { reopen: ReopenRepo }> }): ReopenContract =>
  (who, id, reason, o = { admin: false }) =>
    d.uow.tenant(who, async (r): Promise<ReopenOutcome> => {
      const out = await r.reopen.reopen(id, reason, who.userId, o.admin);
      if (!out.found) return { kind: "not_found" };
      const allowed = canReopen({ admin: o.admin, actor: who.userId, owner: out.owner ?? null });
      const v = reopenVerdict({ locked: out.locked, allowed });
      if (v === "forbidden") return { kind: "forbidden" };
      if (out.draft && out.locked) return { kind: "draft_exists" };
      if (v === "not_locked" || out.version === null) return { kind: "not_locked" };
      await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return { kind: "ok", version: out.version };
    });
