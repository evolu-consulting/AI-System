// ADM-FR-33 · ADM-FR-55 · đổi trạng thái feature ở danh sách (PATCH kèm version); 409 VERSION_CONFLICT → ConflictDialog
// với `mine = {status}` (plan-frontend D6). Kết quả: "saved" | "conflict" | "failed".
import type { FeatureDetail, FeatureListItem } from "@ai/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConflictSave } from "@/components/shared/conflict/use-conflict-save";
import { notifySuccess } from "@/components/shared/toast";
import { FEATURE_KEYS, type FeatureStatusFilter, useUpdateFeature } from "../api";

type Target = { f: FeatureListItem; status: FeatureStatusFilter };

export function useFeaturePatch(
  fail: (err: unknown) => void,
  nameOf: (f: FeatureListItem) => string,
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const update = useUpdateFeature();
  const target = useRef<Target | null>(null);
  const conflict = useConflictSave<{ status: FeatureStatusFilter }, FeatureDetail>({
    entity: "feature",
    mutate: (body) => update.mutateAsync({ id: target.current?.f.id ?? "", ...body } as never),
    onSaved: () => {
      const { f, status } = target.current as Target;
      const label = t(`features.status.${status}`);
      notifySuccess(t("features.toast.statusChanged", { feature: nameOf(f), status: label }));
    },
    onFail: fail,
    onReload: () => void qc.invalidateQueries({ queryKey: FEATURE_KEYS.all }),
  });
  const patch = (f: FeatureListItem, status: FeatureStatusFilter) => {
    target.current = { f, status };
    return conflict.save({ status }, f.version);
  };
  return { patch, conflictProps: conflict.props };
}
