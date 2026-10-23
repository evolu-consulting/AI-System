// CR-097 K1 · HD-FR-104: owner mở lại HĐ đã khoá — về "Chờ duyệt" (`needs_review`), bỏ khoá + "Đã duyệt", ghi log `reopened`
// (lý do, trạng thái trước, người, lúc) trong `contract_events` (lịch sử HĐ). Tenant bật duyệt ⇒ mở lượt duyệt mới ở cấp 1 (người mở
// lại = người bắt đầu) để duyệt lại; tắt duyệt ⇒ editor bấm "Xác nhận" lần nữa. Xác nhận lại ⇒ khoá lại (trigger DB 0048).
// Quyền owner (`admin` gói) do route chặn TRƯỚC (editor ⇒ 403, 0 SQL); HĐ không thấy / tenant khác ⇒ 404. MỘT tx, 2 câu cố định.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { reopenVerdict } from "../domain/lock.rules";

export type ReopenOutcome =
  | { kind: "ok"; version: number }
  | { kind: "not_found" }
  | { kind: "not_locked" };

export type ReopenRepo = {
  /** MỘT câu (CTE): khoá hàng FOR UPDATE ⇒ (nếu đang khoá) mở lượt duyệt khi tenant bật duyệt + UPDATE + event `reopened`. */
  reopen(id: string, reason: string, actor: string): Promise<ReopenRepoOut>;
};
export type ReopenRepoOut = { found: boolean; locked: boolean; version: number | null };

export type ReopenContract = (who: PackWho, id: string, reason: string) => Promise<ReopenOutcome>;

export const reopenContract =
  (d: { uow: PackUow<KitTxRepos & { reopen: ReopenRepo }> }): ReopenContract =>
  (who, id, reason) =>
    d.uow.tenant(who, async (r): Promise<ReopenOutcome> => {
      const out = await r.reopen.reopen(id, reason, who.userId);
      if (!out.found) return { kind: "not_found" };
      if (reopenVerdict({ locked: out.locked }) === "not_locked" || out.version === null)
        return { kind: "not_locked" };
      await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return { kind: "ok", version: out.version };
    });
