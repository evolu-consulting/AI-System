// ADM-FR-13 · báo lỗi chung của hành động ở danh sách Workflows (toast bền; 409 version → nút "Tải lại").
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { WORKFLOW_KEYS } from "../api";

export function useWorkflowFail() {
  const { t } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      const reload = {
        label: t("common.reload"),
        onClick: () => void qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
      };
      const conflict = err instanceof ApiError && err.code === "VERSION_CONFLICT";
      notifyError(tr(spec.key, spec.params), conflict ? reload : undefined);
    },
    [t, tr, qc],
  );
}
