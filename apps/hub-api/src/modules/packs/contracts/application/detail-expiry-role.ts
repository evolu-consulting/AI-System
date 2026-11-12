// CR-127 · SG1 · BR-68 · `can.expiry` của chi tiết HĐ: bấm được khi HĐ đã duyệt đang "Sắp hết hạn" (bản hiện hành, chưa Gia hạn/Chấm dứt) VÀ người gọi là người phụ trách ∪
// trưởng phòng của họ ∪ quản trị công ty VÀ công ty KHÔNG có quy trình `contract.expiring` khớp (có ⇒ quyết trong việc của quy trình). Bọc `detail` như `withHoldRole`:
// chỉ tra vai / quy trình khi TRẠNG THÁI cho phép nút (đa số HĐ: 0 truy vấn thêm).
import type { PackWho } from "../../kit/public";
import type { Can } from "./contract-can";
import type { GetContract } from "./get-contract.usecase";

type DetailLike = {
  id: string;
  status: string;
  effect: string | null;
  superseded: boolean;
  owner_user_id: string | null;
  created_by: string;
  can: Can;
};

export function withExpiryCan<D extends DetailLike>(
  inner: GetContract<D>,
  d: {
    stateOk(c: { status: string; superseded: boolean; effect: string | null }): boolean;
    roleOk(who: PackWho, c: { owner: string | null; created_by: string }): Promise<boolean>;
    flowOpen(who: PackWho, id: string): Promise<boolean>;
  },
): GetContract<D> {
  return async (who, id) => {
    const c = await inner(who, id);
    if (!c || !d.stateOk(c)) return c;
    if (!(await d.roleOk(who, { owner: c.owner_user_id, created_by: c.created_by }))) return c;
    if (await d.flowOpen(who, c.id)) return c;
    return { ...c, can: { ...c.can, expiry: true } };
  };
}
