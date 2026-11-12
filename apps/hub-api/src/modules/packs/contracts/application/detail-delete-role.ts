// CR-127 · Z8 · `can.delete` của chi tiết HĐ: cùng luật `canDeleteContract` với guard của DELETE / xem trước (một nguồn). Vai lấy từ cache cấu hình
// (0 SQL thêm), trạng thái + người tạo / phụ trách có sẵn trong chi tiết.
import type { PackWho } from "../../kit/public";
import { canDeleteContract, type DeleteRole } from "../domain/delete-contract.rules";
import type { Can } from "./contract-can";
import type { GetContract } from "./get-contract.usecase";

type DetailLike = {
  status: string;
  owner_user_id: string | null;
  created_by: string;
  can: Can;
};

export function withDeleteCan<D extends DetailLike>(
  inner: GetContract<D>,
  roleOf: (who: PackWho) => Promise<DeleteRole>,
): GetContract<D> {
  return async (who, id) => {
    const d = await inner(who, id);
    if (!d) return d;
    const ok = canDeleteContract(d, who.userId, await roleOf(who));
    return { ...d, can: { ...d.can, delete: ok } };
  };
}
