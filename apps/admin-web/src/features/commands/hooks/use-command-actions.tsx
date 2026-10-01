// ADM-FR-20 · ADM-BR-06 · hành động trên một command ở danh sách: bật/tắt (lạc quan, tắt có Hoàn tác 5 s), xoá (gõ lại tên).
import type { CommandListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { COMMAND_KEYS, useDeleteCommand, useUpdateCommand } from "../api";

export const UNDO_TOAST_MS = 5000;

export function useCommandActions() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  const update = useUpdateCommand();
  const del = useDeleteCommand();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [toDelete, setToDelete] = useState<CommandListItem | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      const conflict = err instanceof ApiError && err.code === "VERSION_CONFLICT";
      const reload = {
        label: t("common.reload"),
        onClick: () => void qc.invalidateQueries({ queryKey: COMMAND_KEYS.all }),
      };
      notifyError(tr(spec.key, spec.params), conflict ? reload : undefined);
    },
    [t, tr, qc],
  );

  const setPending = useCallback(
    (id: string, value: boolean | undefined) =>
      setOptimistic((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[id];
        else next[id] = value;
        return next;
      }),
    [],
  );

  const toggle = useCallback(
    async (c: CommandListItem, enabled: boolean) => {
      setPending(c.id, enabled);
      try {
        const res = await update.mutateAsync({ id: c.id, version: c.version, enabled });
        if (enabled) return notifySuccess(t("commands.toast.enabled", { name: c.name }));
        // Hoàn tác = bật lại bằng version mới nhận từ server.
        const undo = {
          label: t("common.undo"),
          onClick: () =>
            void update.mutateAsync({ id: c.id, version: res.version, enabled: true }).catch(fail),
        };
        notifySuccess(t("commands.toast.disabled", { name: c.name }), undo, UNDO_TOAST_MS);
      } catch (err) {
        fail(err);
      } finally {
        setPending(c.id, undefined);
      }
    },
    [update, t, fail, setPending],
  );

  const confirmDelete = async () => {
    const c = toDelete;
    if (!c) return;
    try {
      await del.mutateAsync(c.id);
      notifySuccess(t("commands.toast.deleted", { name: c.name }));
    } catch (err) {
      fail(err);
      throw err; // giữ hộp thoại mở
    }
  };

  const features = toDelete?.features.map((f) => pickLocalized(f.name, i18n.language)).join(", ");
  const dialog = (
    <ConfirmDialog
      open={!!toDelete}
      onOpenChange={(open) => !open && setToDelete(null)}
      title={t("commands.delete.title", { name: toDelete?.name ?? "" })}
      description={t("commands.delete.body", {
        features: features ?? "",
        name: toDelete?.name ?? "",
      })}
      confirmLabel={t("commands.delete.submit")}
      destructive
      level="heavy"
      confirmText={toDelete?.name}
      typePrompt={t("commands.delete.typeToConfirm", { name: toDelete?.name ?? "" })}
      onConfirm={confirmDelete}
    />
  );
  return { optimistic, toggle, remove: setToDelete, dialog };
}
