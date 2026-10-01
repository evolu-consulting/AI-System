// ADM-FR-20 · ADM-BR-06 · ADM-FR-55 · bật/tắt command ở danh sách: lạc quan theo hàng, tắt có Hoàn tác 5 s (= bật lại bằng
// version mới); 409 VERSION_CONFLICT → ConflictDialog với `mine = {enabled}` (plan-frontend D6).
import type { Command, CommandListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { COMMAND_KEYS, useUpdateCommand } from "../api";

export const UNDO_TOAST_MS = 5000;
type Target = { c: CommandListItem; enabled: boolean };

export function useCommandToggle(fail: (err: unknown) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const update = useUpdateCommand();
  const target = useRef<Target | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const setPending = useCallback((id: string, value: boolean | undefined) => {
    setOptimistic((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return value === undefined ? rest : { ...rest, [id]: value };
    });
  }, []);
  const conflict = useConflictSave<{ enabled: boolean }, Command>({
    entity: "command",
    mutate: (body) => update.mutateAsync({ id: target.current?.c.id ?? "", ...body }),
    onSaved: (res) => {
      const { c, enabled } = target.current as Target;
      if (enabled) return notifySuccess(t("commands.toast.enabled", { name: c.name }));
      const undo = {
        label: t("common.undo"),
        onClick: () =>
          void update.mutateAsync({ id: c.id, version: res.version, enabled: true }).catch(fail),
      };
      notifySuccess(t("commands.toast.disabled", { name: c.name }), undo, UNDO_TOAST_MS);
    },
    onFail: fail,
    onReload: () => void qc.invalidateQueries({ queryKey: COMMAND_KEYS.all }),
  });
  const saveRef = useRef(conflict.save);
  saveRef.current = conflict.save;
  const toggle = useCallback(
    async (c: CommandListItem, enabled: boolean) => {
      target.current = { c, enabled };
      setPending(c.id, enabled);
      try {
        await saveRef.current({ enabled }, c.version);
      } finally {
        setPending(c.id, undefined);
      }
    },
    [setPending],
  );
  return { optimistic, toggle, conflictProps: conflict.props };
}
