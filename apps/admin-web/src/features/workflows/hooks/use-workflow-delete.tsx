// ADM-FR-13 · AC-A05 · xoá workflow ở danh sách: còn dùng → hộp thoại chặn (command + agent); chưa dùng → gõ key.
import type { WorkflowListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { ApiError } from "@/lib/http";
import { fetchWorkflowUsages, useDeleteWorkflow, WORKFLOW_KEYS } from "../api";
import type { BlockedInfo } from "../components/list/WorkflowBlockedDialog";
import { WorkflowDeleteDialog } from "../components/list/WorkflowDeleteDialog";
import { blockedFrom } from "../lib/blocked";

type Fail = (err: unknown) => void;

export function useWorkflowDelete(fail: Fail, block: (b: BlockedInfo) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const del = useDeleteWorkflow();
  const [toDelete, setToDelete] = useState<WorkflowListItem | null>(null);

  // Luôn hỏi `usages` mới: cờ `unattached` của danh sách có thể cũ (command vừa gắn ở màn khác).
  const remove = useCallback(
    async (w: WorkflowListItem) => {
      try {
        const u = await qc.fetchQuery({
          queryKey: WORKFLOW_KEYS.usages(w.id),
          queryFn: () => fetchWorkflowUsages(w.id),
          staleTime: 0,
        });
        if (u.commands.length === 0 && u.agents.length === 0) return setToDelete(w);
        block({ action: "delete", workflowKey: w.key, commands: u.commands, agents: u.agents });
      } catch (err) {
        fail(err);
      }
    },
    [qc, fail, block],
  );
  const confirm = async () => {
    const w = toDelete;
    if (!w) return;
    try {
      await del.mutateAsync(w.id);
      notifySuccess(t("workflows.toast.deleted", { name: w.key }));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "WORKFLOW_IN_USE")) {
        fail(err);
        throw err; // giữ hộp thoại mở
      }
      setToDelete(null);
      block(blockedFrom(w.key, "delete", err));
    }
  };
  const dialog = (
    <WorkflowDeleteDialog target={toDelete} onClose={() => setToDelete(null)} onConfirm={confirm} />
  );
  return { remove, dialog };
}
