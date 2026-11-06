// CR-121 D-1 · dữ kiện HIỆN TẠI của HĐ cho rẽ/kiểm lại bước (tách khỏi `approval-engine.usecase.ts`, trần 400 dòng).
import type { PackWho } from "../../kit/public";
import { factsOf } from "../domain/approval-engine.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { type FlowFacts, factNeedsOf } from "../domain/approval-flow-cond.rules";
import type {
  ApprovalEngineTxRepos,
  CreatorDepartments,
  EngineRunRow,
} from "./approval-engine.ports";
import type { ApprovalEngineDeps } from "./approval-engine.usecase";
import type { FlowGroups } from "./approval-flow.usecase";
/** CR-121 D-1 · nguồn dữ kiện mở rộng: `creatorDepartments` đi kèm `groups` (cùng nguồn Group của tenant, nối lúc mount). */
export type FactsDeps = Pick<ApprovalEngineDeps, "uow"> & {
  groups?:
    | (Partial<FlowGroups> & { creatorDepartments?: CreatorDepartments | undefined })
    | undefined;
};

/** CR-121 D-1 · `new_partner` trong tx gói đang mở (MỘT câu, chỉ khi mẫu dùng; repo vắng ⇒ chưa có dữ liệu). */
export const partnerIn = async (
  r: ApprovalEngineTxRepos,
  id: string,
  steps: readonly FlowStep[],
) => (factNeedsOf(steps).partner && r.flowFacts ? r.flowFacts.newPartner(id) : null);

/** CR-121 D-1 · phòng ban người bắt đầu lượt (= danh tính run của tool) + phòng cha; NGOÀI tx gói. Không cần / không nối ⇒ null. */
export async function departmentsOf(d: FactsDeps, who: PackWho, need: boolean) {
  const f = d.groups?.creatorDepartments;
  return need && f ? f(who.tenantId, who.userId) : null;
}

/** Dữ kiện đầy đủ theo giá trị HIỆN TẠI của HĐ (loại, giá trị từ hàng vừa đọc + phòng ban + đối tác mới). */
export const fullFacts = (
  row: EngineRunRow,
  depts: readonly string[] | null,
  partner: boolean | null,
): FlowFacts => ({
  ...factsOf(row.deal, row.totalValue),
  creator_departments: depts,
  new_partner: partner,
});
