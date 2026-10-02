// ADM-FR-55 · M3-R20 · "Đổi tên group": PATCH kèm version, 409 → ConflictDialog (entity "group", câu có {user}, A4).
// Version lấy từ `group.version` lúc bấm Lưu (query đã làm mới sau mỗi lần lưu thành công).
import type { Group } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useUpdateGroup } from "../api";
import { type GroupFormValues, toRenameBody } from "../lib/schemas";

type Body = ReturnType<typeof toRenameBody>;
type Handlers = { onSaved: () => void; onReload: () => void };

export function useGroupConflict(group: Group, h: Handlers) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const update = useUpdateGroup(group.id);
  const conflict = useConflictSave<Body, Group>({
    entity: "group",
    mutate: (body) => update.mutateAsync(body),
    onSaved: (res) => {
      notifySuccess(t("groups.toast.saved", { name: pickLocalized(res.name, i18n.language) }));
      h.onSaved();
    },
    onFail: (err) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    },
    onReload: h.onReload,
  });
  const save = (values: GroupFormValues) => conflict.save(toRenameBody(values), group.version);
  return { save, props: conflict.props, pending: update.isPending };
}
