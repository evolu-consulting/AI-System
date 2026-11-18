// CR-182 · giao việc theo vai: `PUT /pack/contracts/approval-flow/roles` (chỉ quản trị công ty).
import type { ApprovalFlowRoleAssigned } from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";
import type { RolePick } from "./lib/flow-roles";
import { assignBody } from "./lib/flow-roles";

export const assignRole = (flowId: string, roleKey: string, pick: RolePick) =>
  api<ApprovalFlowRoleAssigned>("/pack/contracts/approval-flow/roles", {
    method: "PUT",
    body: assignBody(flowId, roleKey, pick),
  });
