// ADM-FR-13 · AC-A05 · hành động trên một workflow ở danh sách: ghép bật/tắt (use-workflow-toggle) và xoá (use-workflow-delete).
import { useState } from "react";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { type BlockedInfo, WorkflowBlockedDialog } from "../components/list/WorkflowBlockedDialog";
import { useWorkflowDelete } from "./use-workflow-delete";
import { useWorkflowFail } from "./use-workflow-fail";
import { useWorkflowToggle } from "./use-workflow-toggle";

export function useWorkflowActions() {
  const fail = useWorkflowFail();
  const [blocked, setBlocked] = useState<BlockedInfo | null>(null);
  const toggle = useWorkflowToggle(fail, setBlocked);
  const del = useWorkflowDelete(fail, setBlocked);
  const dialogs = (
    <>
      <WorkflowBlockedDialog info={blocked} onClose={() => setBlocked(null)} />
      {del.dialog}
      <LazyConflictDialog props={toggle.conflictProps} />
    </>
  );
  return { toggle: toggle.toggle, remove: del.remove, dialogs };
}
