// DLC-R14 · bảng flow AI SDLC: danh sách, bật/tắt (patch) và xoá workflow.
import type { DlcWorkflow } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDeleteDlcWorkflow, useDlcWorkflows, usePatchDlcWorkflow } from "../api";

export function useDlcFlowItems(): DlcWorkflow[] {
  return useDlcWorkflows().data?.items ?? [];
}

export function useDlcWorkflowToggle(w: DlcWorkflow) {
  const patch = usePatchDlcWorkflow();
  const toggle = (enabled: boolean) =>
    patch.mutate(
      { id: w.id, patch: { enabled, version: w.version } },
      { onError: (e) => toast.error((e as Error).message) },
    );
  return { toggle, isPending: patch.isPending };
}

export function useDlcWorkflowRemove() {
  const { t } = useTranslation();
  const del = useDeleteDlcWorkflow();
  return async (removing: DlcWorkflow | null) => {
    if (removing) await del.mutateAsync(removing.id);
    toast.success(t("dlcAdmin.deleted"));
  };
}
