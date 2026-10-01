// ADM-FR-20 · hành động trên một command ở danh sách: bật/tắt (use-command-toggle) và xoá gõ tên.
import type { CommandListItem } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { useDeleteCommand } from "../api";
import { CommandDeleteDialog } from "../components/list/CommandDeleteDialog";
import { useCommandFail } from "./use-command-fail";
import { useCommandToggle } from "./use-command-toggle";

export function useCommandActions() {
  const { t } = useTranslation();
  const fail = useCommandFail();
  const { optimistic, toggle } = useCommandToggle(fail);
  const del = useDeleteCommand();
  const [toDelete, setToDelete] = useState<CommandListItem | null>(null);

  const confirmDelete = async () => {
    const c = toDelete;
    if (!c) return;
    await del.mutateAsync(c.id).catch((err) => {
      fail(err);
      throw err; // giữ hộp thoại mở
    });
    notifySuccess(t("commands.toast.deleted", { name: c.name }));
  };
  const dialog = (
    <CommandDeleteDialog
      target={toDelete}
      onClose={() => setToDelete(null)}
      onConfirm={confirmDelete}
    />
  );
  return { optimistic, toggle, remove: setToDelete, dialog };
}
