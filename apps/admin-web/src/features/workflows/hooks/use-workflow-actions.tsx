// ADM-FR-13 · AC-A05 · hành động trên một workflow ở danh sách: bật/tắt (409 → dialog chặn), xoá (còn dùng → dialog chặn; chưa dùng → gõ key).
import type { WorkflowListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { fetchWorkflowUsages, useDeleteWorkflow, useUpdateWorkflow, WORKFLOW_KEYS } from "../api";
import { type BlockedInfo, WorkflowBlockedDialog } from "../components/WorkflowBlockedDialog";

type InUseDetails = {
  action?: string;
  commands?: BlockedInfo["commands"];
  agents?: BlockedInfo["agents"];
};

function blockedFrom(key: string, fallback: BlockedInfo["action"], err: ApiError): BlockedInfo {
  const d = (err.details ?? {}) as InUseDetails;
  return {
    action: d.action === "disable" || d.action === "delete" ? d.action : fallback,
    workflowKey: key,
    commands: d.commands ?? [],
    agents: d.agents ?? [],
  };
}

export function useWorkflowActions() {
  const { t } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  const update = useUpdateWorkflow();
  const del = useDeleteWorkflow();
  const [blocked, setBlocked] = useState<BlockedInfo | null>(null);
  const [toDelete, setToDelete] = useState<WorkflowListItem | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      const conflict = err instanceof ApiError && err.code === "VERSION_CONFLICT";
      notifyError(
        tr(spec.key, spec.params),
        conflict
          ? {
              label: t("common.reload"),
              onClick: () => void qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
            }
          : undefined,
      );
    },
    [t, tr, qc],
  );

  const toggle = useCallback(
    async (w: WorkflowListItem) => {
      try {
        await update.mutateAsync({ id: w.id, version: w.version, enabled: !w.enabled });
        notifySuccess(
          t(w.enabled ? "workflows.toast.disabled" : "workflows.toast.enabled", { name: w.key }),
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === "WORKFLOW_IN_USE") {
          setBlocked(blockedFrom(w.key, "disable", err));
        } else fail(err);
      }
    },
    [update, t, fail],
  );

  const remove = useCallback(
    async (w: WorkflowListItem) => {
      if (w.unattached) return setToDelete(w);
      try {
        const u = await qc.fetchQuery({
          queryKey: WORKFLOW_KEYS.usages(w.id),
          queryFn: () => fetchWorkflowUsages(w.id),
          staleTime: 0,
        });
        setBlocked({
          action: "delete",
          workflowKey: w.key,
          commands: u.commands,
          agents: u.agents,
        });
      } catch (err) {
        fail(err);
      }
    },
    [qc, fail],
  );

  const confirmDelete = async () => {
    const w = toDelete;
    if (!w) return;
    try {
      await del.mutateAsync(w.id);
      notifySuccess(t("workflows.toast.deleted", { name: w.key }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "WORKFLOW_IN_USE") {
        setToDelete(null);
        setBlocked(blockedFrom(w.key, "delete", err));
        return;
      }
      fail(err);
      throw err; // giữ hộp thoại mở
    }
  };

  const dialogs = (
    <>
      <WorkflowBlockedDialog info={blocked} onClose={() => setBlocked(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("workflows.delete.title", { key: toDelete?.key ?? "" })}
        confirmLabel={t("workflows.delete.submit")}
        destructive
        level="heavy"
        confirmText={toDelete?.key}
        typePrompt={t("workflows.delete.typeToConfirm", { key: toDelete?.key ?? "" })}
        onConfirm={confirmDelete}
      />
    </>
  );
  return { toggle, remove, dialogs };
}
