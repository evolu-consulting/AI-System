// CR-121 F4b · D6: bật/tắt lệnh ngay trên hàng Công cụ AI (thay công tắc của danh sách lệnh cũ). Đọc bản MỚI (version hiện tại);
// tắt có "Hoàn tác" 5 s; 409 VERSION_CONFLICT ⇒ ConflictDialog với `mine = {enabled}`.
import type { Command } from "@ai/contracts/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { COMMAND_KEYS, useUpdateCommand } from "@/features/commands/api";
import { useWorkflowFail } from "@/features/workflows/hooks/use-workflow-fail";
import { api } from "@/lib/http";
import { AI_TOOL_KEYS } from "../api";

export const UNDO_TOAST_MS = 5000;
type Target = { c: Command; enabled: boolean };

export function useCommandRowActions() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useWorkflowFail();
  const update = useUpdateCommand();
  const target = useRef<Target | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: AI_TOOL_KEYS.usage });
  const conflict = useConflictSave<{ enabled: boolean }, Command>({
    entity: "command",
    mutate: (body) => update.mutateAsync({ id: target.current?.c.id ?? "", ...body }),
    onSaved: (res) => {
      void refresh();
      const { c, enabled } = target.current as Target;
      if (enabled) return notifySuccess(t("commands.toast.enabled", { name: c.name }));
      const undo = {
        label: t("common.undo"),
        onClick: () =>
          void update
            .mutateAsync({ id: c.id, version: res.version, enabled: true })
            .then(refresh)
            .catch(fail),
      };
      notifySuccess(t("commands.toast.disabled", { name: c.name }), undo, UNDO_TOAST_MS);
    },
    onFail: fail,
    onReload: () => {
      void qc.invalidateQueries({ queryKey: COMMAND_KEYS.all });
      void refresh();
    },
  });
  const toggleById = async (id: string, enabled: boolean) => {
    try {
      const c = await qc.fetchQuery({
        queryKey: COMMAND_KEYS.detail(id),
        queryFn: () => api<Command>(`/admin/commands/${id}`),
        staleTime: 0,
      });
      target.current = { c, enabled };
      await conflict.save({ enabled }, c.version);
    } catch (err) {
      fail(err);
    }
  };
  return { toggleById, dialogs: <LazyConflictDialog props={conflict.props} /> };
}

export type CommandRowActions = ReturnType<typeof useCommandRowActions>;
