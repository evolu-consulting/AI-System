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
};
