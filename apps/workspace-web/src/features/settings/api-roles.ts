// CR-182 · giao việc theo vai: `PUT /pack/contracts/approval-flow/roles` (chỉ quản trị công ty).
import type {
  ApprovalFlowGroupMembers,
  ApprovalFlowRoleAssigned,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";
import type { RolePick } from "./lib/flow-roles";
import { assignBody } from "./lib/flow-roles";

export const assignRole = (flowId: string, roleKey: string, pick: RolePick) =>
  api<ApprovalFlowRoleAssigned>("/pack/contracts/approval-flow/roles", {
    method: "PUT",
    body: assignBody(flowId, roleKey, pick),
  });

/** CR-182 · một trang thành viên của nhóm (tải dần): hiện ngay khi chọn nhóm, trước khi lưu. Avatar + chức vụ lấy ở `GET /people?ids=`. */
export const fetchGroupMembers = (groupId: string, offset: number, signal?: AbortSignal) =>
  api<ApprovalFlowGroupMembers>(`/pack/contracts/groups/${groupId}/members`, {
    query: { offset: String(offset), limit: "30" },
    signal,
  });
