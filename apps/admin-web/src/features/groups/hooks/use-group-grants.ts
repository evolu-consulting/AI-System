// ADM-FR-32 · M3-R07, R08 · tab Feature của group: nạp cột của group, chế độ Sửa (nháp tick), lưu MỘT batch.
import type { Group } from "@ai/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { useApplyGrants, useGroupMatrix } from "../api";
import { toRows } from "../lib/grants";
import { useGrantDraft } from "./use-grant-draft";

export function useGroupGrants(group: Group) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const query = useGroupMatrix(group.tenant_id, group.id);
  const apply = useApplyGrants(group.tenant_id);
  const rows = useMemo(
    () => (query.data ? toRows(query.data, group.id) : []),
    [query.data, group.id],
  );
  const draft = useGrantDraft(rows, group.id);

  const save = async () => {
    try {
      await apply.mutateAsync(draft.plan);
      const name = pickLocalized(group.name, i18n.language);
      notifySuccess(t("groups.toast.featuresSaved", { group: name }));
      draft.close();
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err, { coreProtected: "access.error.coreProtected" });
      notifyError(tr(spec.key, spec.params));
      void query.refetch();
    }
  };
  const e = query.error instanceof ApiError ? query.error : null;
  const loadError = { message: e?.message ?? "", code: e?.code ?? "HTTP_ERROR" };
  return { query, rows, draft, save, loadError, pending: apply.isPending };
}
