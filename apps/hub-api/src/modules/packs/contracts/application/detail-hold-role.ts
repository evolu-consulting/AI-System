// CR-127 · X3 · R#18 · `can.hold/release` của chi tiết HĐ theo VAI: người phụ trách ∪ trưởng phòng của họ ∪ quản trị công ty. `canOf` (thuần) chỉ biết
// người phụ trách; bọc `detail` để cộng hai vai còn lại. Chỉ tra vai khi TRẠNG THÁI cho phép nút và người gọi chưa phải người phụ trách (đa số ca: 0 truy vấn thêm).
import type { PackWho } from "../../kit/public";
import { type Can, type CanFacts, holdCan } from "./contract-can";
import type { GetContract } from "./get-contract.usecase";

type DetailLike = CanFacts & { can: Can };

export function withHoldRole<D extends DetailLike>(
  inner: GetContract<D>,
  roleOk: (who: PackWho, c: { owner: string | null; created_by: string }) => Promise<boolean>,
): GetContract<D> {
  return async (who, id) => {
    const d = await inner(who, id);
    if (!d || (d.can.hold && d.can.release)) return d;
    const st = holdCan(d);
    if (!(st.hold || st.release) || d.owner_user_id === who.userId) return d;
    if (!(await roleOk(who, { owner: d.owner_user_id, created_by: d.created_by }))) return d;
    return { ...d, can: { ...d.can, hold: st.hold, release: st.release } };
  };
}
