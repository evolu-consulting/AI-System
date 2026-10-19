// HD-FR-36 · dữ liệu giả thẻ duyệt S05 (`GET /pack/contracts/contracts/:id/approval`) cho cảnh so mgmt-app và e2e HD3.
import type { ContractApproval } from "@ai/contracts";

export const APPROVAL_RUN = "a3d30000-0000-4000-8000-000000000001";
export const APPROVAL_TASK = "a3d30000-0000-4000-8000-000000000002";

export function approvalAsHub(
  step: ContractApproval["step"],
  o: Partial<ContractApproval> = {},
): ContractApproval {
  if (step === null)
    return {
      run_id: null,
      run_status: null,
      step: null,
      task_id: null,
      can_act: false,
      feedback: null,
    };
  const open = step === "level1" || step === "level2";
  return {
    run_id: APPROVAL_RUN,
    run_status: open ? "waiting_review" : step === "done" ? "done" : "running",
    step,
    task_id: open ? APPROVAL_TASK : null,
    can_act: open,
    feedback: null,
    ...o,
  };
}
