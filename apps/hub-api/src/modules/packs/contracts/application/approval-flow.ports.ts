// CR-105 L4 · kiểu cổng dùng chung của luồng duyệt (tách khỏi `approval-flow.usecase.ts` để phá vòng với `approval-engine.ports.ts`).
import type { ApprovalSettings } from "../domain/approval-def.rules";

export type ApprovalFlowRepo = {
  settings(): Promise<ApprovalSettings>;
};
export type ApprovalFlowTxRepos = { approvalFlow: ApprovalFlowRepo };

/** Group của tenant: id theo khoá (phân giải mã) + id nào còn tồn tại. */
export type FlowGroups = {
  idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  existingIds(tenantId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** S3b · Group của tenant (id + tên) cho `GET /pack/contracts/groups`. */
  list?(tenantId: string): Promise<{ id: string; name: string }[]>;
  /** CR-108 · số thành viên còn dùng được mỗi Group (id ⇒ số); vắng ⇒ không hiện số người duyệt. */
  memberCounts?(tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** CR-182 · thành viên dùng được (id + tên, tối đa `max` mỗi Group) của các Group: MỘT câu cho cả lô; vắng ⇒ không hiện danh sách. */
  members?(
    tenantId: string,
    ids: readonly string[],
    max: number,
  ): Promise<ReadonlyMap<string, { id: string; name: string }[]>>;
  /** CR-182 · MỘT trang thành viên dùng được của một Group (theo tên, từ `offset`, tối đa `limit`); vắng ⇒ không có API thành viên. */
  membersPage?(
    tenantId: string,
    id: string,
    offset: number,
    limit: number,
  ): Promise<{ id: string; name: string }[]>;
};
