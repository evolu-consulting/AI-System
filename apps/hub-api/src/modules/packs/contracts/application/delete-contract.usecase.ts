// V2-M · HD-07 · 5.5e · 6a · C7: xoá HĐ hẳn. Lớp 2 — không SQL. MỘT tx `PackUow`: đảo kho (`reverseStock`) rồi hàm
// `contracts.delete_contract` (voids sổ đối tác, gỡ khách đang dùng / SP sinh từ HĐ, xoá mốc + dòng giao, một dòng audit).
// Lỗi bất kỳ ⇒ tx huỷ, không đổi gì. CR-127 Z8: quyền kiểm Ở ĐÂY trong cùng tx (khoá hàng, đọc trạng thái hiện tại) bằng `canDeleteContract`
// — HĐ draft: quản trị gói / người tạo / người phụ trách; khác draft: quản trị gói. Route chỉ chặn người không đọc được gói.

import type { PackUow, PackWho } from "../../kit/public";
import { canDeleteContract, type DeleteRole } from "../domain/delete-contract.rules";
import type { DeleteImpact, DeleteResult } from "../domain/delivery.types";
import { localDate } from "../domain/local-time.rules";
import { StockError } from "../domain/stock.rules";
import { deleteVerdict } from "../domain/versions.rules";

export type DeleteFactsRow = {
  status: string;
  created_by: string;
  owner_user_id: string | null;
  submit_round: number;
};
export type DeleteContractRepo = {
  /** CR-127 Z8: trạng thái hiện tại + người tạo / phụ trách + số vòng gửi duyệt (một câu theo PK); `lock` ⇒ `FOR UPDATE` (xoá). Không thấy ⇒ null. */
  facts(contractId: string, lock: boolean): Promise<DeleteFactsRow | null>;
  /** CR-097 K2: chuỗi phiên bản của HĐ (không thấy ⇒ null). */
  chain(contractId: string): Promise<{ versions: number; draft: boolean } | null>;
  /** Tác động của việc xoá (một câu); HĐ không có / không thấy ⇒ null. */
  preview(contractId: string, on: string): Promise<DeleteImpact | null>;
  /** Đảo kho của HĐ (V2-M `reverseContractStock`); trả số dòng đã đảo. Ném `StockError`. */
  reverseStock(contractId: string, on: string): Promise<number>;
  /** `contracts.delete_contract`; null = không thấy. Ném `DeleteContractFail` khi còn phụ lục / gắn CKS. */
  remove(
    contractId: string,
    products: readonly string[],
  ): Promise<
    | (Omit<DeleteResult, "deleted" | "impact"> & {
        milestones: number;
        stock_reversed: number;
        service_customers: number;
        products: number;
        partner_events_voided: number;
        appendices: number;
      })
    | null
  >;
};
export type DeleteContractRepos = { deleteContract: DeleteContractRepo };

export class DeleteContractFail extends Error {
  constructor(
    readonly kind: "not_found" | "stock_blocked" | "has_versions" | "forbidden",
    readonly detail: string = kind,
    readonly shortages: { componentId: string; need: string; have: string }[] = [],
  ) {
    super(detail);
  }
}

type Deps = {
  uow: PackUow<DeleteContractRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
};

/** CR-127 Z8: HĐ không thấy ⇒ 404; thấy mà không đủ quyền ⇒ 403. Trả hàng sự thật (dùng cho cờ "đã từng gửi duyệt"). */
async function guardAccess(
  r: DeleteContractRepos,
  who: PackWho,
  id: string,
  role: DeleteRole,
  lock: boolean,
): Promise<DeleteFactsRow> {
  const f = await r.deleteContract.facts(id, lock);
  if (!f) throw new DeleteContractFail("not_found");
  if (!canDeleteContract(f, who.userId, role)) throw new DeleteContractFail("forbidden");
  return f;
}

/** CR-097b (X5): trong chuỗi nhiều phiên bản chỉ xoá được bản nháp mở; HĐ không thấy ⇒ để bước sau trả 404. */
async function guardChain(r: DeleteContractRepos, id: string): Promise<void> {
  const ch = await r.deleteContract.chain(id);
  if (ch && deleteVerdict(ch) !== "ok") throw new DeleteContractFail("has_versions");
}

export function deleteContractUsecases(d: Deps) {
  return {
    preview: async (who: PackWho, id: string, role: DeleteRole): Promise<DeleteImpact> => {
      const on = localDate(d.now(), await d.timeZoneOf(who.tenantId));
      const out = await d.uow.tenant(who, async (r) => {
        const f = await guardAccess(r, who, id, role, false);
        await guardChain(r, id);
        const i = await r.deleteContract.preview(id, on);
        return i && f.status === "draft" && f.submit_round > 0
          ? { ...i, submitted_before: true }
          : i;
      });
      if (!out) throw new DeleteContractFail("not_found");
      return out;
    },
    /** `removeProducts`: SP người xoá đã tick (products-confirm) — chỉ SP không còn HĐ khác dùng mới bị xoá. */
    remove: async (
      who: PackWho,
      id: string,
      removeProducts: readonly string[],
      role: DeleteRole,
    ): Promise<DeleteResult> => {
      const on = localDate(d.now(), await d.timeZoneOf(who.tenantId));
      return d.uow.tenant(who, async (r) => {
        await guardAccess(r, who, id, role, true);
        await guardChain(r, id);
        try {
          await r.deleteContract.reverseStock(id, on);
        } catch (e) {
          if (e instanceof StockError)
            throw new DeleteContractFail("stock_blocked", e.detail, e.shortages);
          throw e;
        }
        const x = await r.deleteContract.remove(id, removeProducts);
        if (!x) throw new DeleteContractFail("not_found");
        const { audit_id, ...impact } = x;
        return { deleted: true, audit_id, impact };
      });
    },
  };
}
export type DeleteContractUsecases = ReturnType<typeof deleteContractUsecases>;
