// ADM-FR-62 · M3-R04 · xoá group (mức nặng: gõ key): nêu số thành viên/feature; `beta-testers` không có đường xoá.
import type { GroupListItem } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useDeleteGroup } from "../api";
import { GroupDeleteDialog } from "../components/list/GroupDeleteDialog";

export function useGroupDelete() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const del = useDeleteGroup();
  const [target, setTarget] = useState<GroupListItem | null>(null);

  const confirm = async () => {
    const g = target;
    if (!g) return;
    await del.mutateAsync(g).catch((err: unknown) => {
      if (!(err instanceof ApiError && err.code === "UNAUTHORIZED")) {
        const spec = describeError(err);
        notifyError(tr(spec.key, spec.params));
      }
      throw err; // giữ hộp thoại mở
    });
    notifySuccess(t("groups.toast.deleted", { name: pickLocalized(g.name, i18n.language) }));
  };
  const dialog = (
    <GroupDeleteDialog target={target} onClose={() => setTarget(null)} onConfirm={confirm} />
  );
  return { remove: setTarget, dialog };
}
