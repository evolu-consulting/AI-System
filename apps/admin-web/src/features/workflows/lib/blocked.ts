// ADM-FR-13 · AC-A05 · dựng thông tin hộp thoại chặn từ `details` của 409 `WORKFLOW_IN_USE` (command + agent đang dùng).
import type { ApiError } from "@/lib/http";
import type { BlockedInfo } from "../components/list/WorkflowBlockedDialog";

type InUseDetails = {
  action?: string;
  commands?: BlockedInfo["commands"];
  agents?: BlockedInfo["agents"];
};

export function blockedFrom(
  key: string,
  fallback: BlockedInfo["action"],
  err: ApiError,
): BlockedInfo {
  const d = (err.details ?? {}) as InUseDetails;
  return {
    action: d.action === "disable" || d.action === "delete" ? d.action : fallback,
    workflowKey: key,
    commands: d.commands ?? [],
    agents: d.agents ?? [],
  };
}
