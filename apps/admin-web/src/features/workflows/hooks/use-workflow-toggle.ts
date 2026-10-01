// ADM-FR-13 · AC-A06 · bật/tắt workflow ở danh sách; tắt khi còn command bật/agent → 409 → hộp thoại chặn.
import type { WorkflowListItem } from "@ai/contracts";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { ApiError } from "@/lib/http";
import { useUpdateWorkflow } from "../api";
import type { BlockedInfo } from "../components/list/WorkflowBlockedDialog";
import { blockedFrom } from "../lib/blocked";

export function useWorkflowToggle(fail: (err: unknown) => void, block: (b: BlockedInfo) => void) {
  const { t } = useTranslation();
  const update = useUpdateWorkflow();
  return useCallback(
    async (w: WorkflowListItem) => {
      try {
        await update.mutateAsync({ id: w.id, version: w.version, enabled: !w.enabled });
        const key = w.enabled ? "workflows.toast.disabled" : "workflows.toast.enabled";
        notifySuccess(t(key, { name: w.key }));
      } catch (err) {
        if (err instanceof ApiError && err.code === "WORKFLOW_IN_USE") {
          block(blockedFrom(w.key, "disable", err));
        } else fail(err);
      }
    },
    [update, t, fail, block],
  );
}
