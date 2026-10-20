// HD-FR-07 · HD-FR-06 · HD-AC01 · HD-AC12 · D-13 · HD1 plan §1 §2 §6: chi tiết HĐ của tenant token — MỘT câu SQL (hàng + items +
// 50 event mới nhất + tệp + V2-A mốc) trong tx RLS `PackUow` (= 2 câu gồm `set_config`). id lạ / tenant khác ⇒ `null` (route ⇒ 404).
// V2-A: giai đoạn suy từ mốc theo ngày lịch tenant (`today`, cache múi giờ — 0 SQL).
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ContractsReadRepo } from "./ports";

export type GetContract<Detail> = (who: PackWho, id: string) => Promise<Detail | null>;

export function getContract<Detail>(d: {
  uow: PackUow<{ contracts: Pick<ContractsReadRepo<unknown, unknown, Detail>, "detail"> }>;
  today?: (tenantId: string) => Promise<string>;
}): GetContract<Detail> {
  return async (who, id) => {
    const today = await (d.today?.(who.tenantId) ?? new Date().toISOString().slice(0, 10));
    return d.uow.tenant(who, (r) => r.contracts.detail(id, today));
  };
}
