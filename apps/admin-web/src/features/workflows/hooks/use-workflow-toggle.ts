// ADM-FR-13 · AC-A06 · ADM-FR-55 · bật/tắt workflow ở danh sách; tắt khi còn command bật/agent → 409 → hộp thoại chặn;
// 409 VERSION_CONFLICT → ConflictDialog với `mine = {enabled}` (plan-frontend D6).
import type { Workflow, WorkflowListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { ApiError } from "@/lib/http";
import { useUpdateWorkflow, WORKFLOW_KEYS } from "../api";
import type { BlockedInfo } from "../components/list/WorkflowBlockedDialog";
import { blockedFrom } from "../lib/blocked";

export function useWorkflowToggle(fail: (err: unknown) => void, block: (b: BlockedInfo) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const update = useUpdateWorkflow();
  const target = useRef<WorkflowListItem | null>(null);
  const conflict = useConflictSave<{ enabled: boolean }, Workflow>({
    entity: "workflow",
    mutate: (body) => update.mutateAsync({ id: target.current?.id ?? "", ...body }),
    onSaved: (res) =>
      notifySuccess(
        t(res.enabled ? "workflows.toast.enabled" : "workflows.toast.disabled", { name: res.key }),
      ),
    onFail: (err) => {
      const w = target.current;
      if (w && err instanceof ApiError && err.code === "WORKFLOW_IN_USE") {
        block(blockedFrom(w.key, "disable", err));
      } else fail(err);
    },
    onReload: () => void qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
  });
  const toggle = (w: WorkflowListItem) => {
    target.current = w;
    return conflict.save({ enabled: !w.enabled }, w.version);
  };
  return { toggle, conflictProps: conflict.props };
}
