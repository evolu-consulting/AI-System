// ADM-FR-32 · ADM-FR-36 · F4 "Cấp {feature} cho group…": chọn group (group của user xếp đầu) → MỘT batch `add` → làm mới quyền hiệu lực.
import type { FeatureMini } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifyInfo, notifySuccess } from "@/components/shared/toast";
import { useGroupOptions } from "@/features/groups/api";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useSaveMatrix } from "../api";

type Args = { tenantId: string; feature: FeatureMini; userGroupIds: string[]; onDone: () => void };

export function useGrantToGroup({ tenantId, feature, userGroupIds, onDone }: Args) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const groups = useGroupOptions(tenantId, true);
  const save = useSaveMatrix(tenantId);
  const [groupId, setGroupId] = useState("");
  const [missing, setMissing] = useState(false);
  const mine = new Set(userGroupIds);
  const options = [...(groups.data ?? [])].sort(
    (a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)),
  );

  const submit = async () => {
    if (!groupId) return setMissing(true);
    const group = options.find((g) => g.id === groupId);
    try {
      await save.mutateAsync({ add: [{ feature_id: feature.id, group_id: groupId }], remove: [] });
      const params = {
        feature: pickLocalized(feature.name, i18n.language),
        group: group ? pickLocalized(group.name, i18n.language) : "",
      };
      notifySuccess(t("access.toast.grantedToGroup", params));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err, { coreProtected: "access.error.coreProtected" });
      (err instanceof ApiError && err.code === "NOT_ENTITLED" ? notifyInfo : notifyError)(
        tr(spec.key, spec.params),
      );
    }
  };
  return {
    options,
    groupId,
    setGroupId: (id: string) => {
      setGroupId(id);
      setMissing(false);
    },
    missing,
    submit,
    pending: save.isPending,
  };
}
