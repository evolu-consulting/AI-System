// ADM-FR-20 · ADM-BR-06 · bật/tắt command ở danh sách: lạc quan theo hàng, tắt có Hoàn tác 5 s (= bật lại bằng version mới).
import type { CommandListItem } from "@ai/contracts";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { useUpdateCommand } from "../api";

export const UNDO_TOAST_MS = 5000;

export function useCommandToggle(fail: (err: unknown) => void) {
  const { t } = useTranslation();
  const update = useUpdateCommand();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const setPending = useCallback((id: string, value: boolean | undefined) => {
    setOptimistic((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return value === undefined ? rest : { ...rest, [id]: value };
    });
  }, []);

  const toggle = useCallback(
    async (c: CommandListItem, enabled: boolean) => {
      setPending(c.id, enabled);
      try {
        const res = await update.mutateAsync({ id: c.id, version: c.version, enabled });
        if (enabled) return notifySuccess(t("commands.toast.enabled", { name: c.name }));
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
  return { optimistic, toggle };
}
