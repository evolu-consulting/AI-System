// ADM-FR-30 · báo lỗi chung của hành động ở danh sách Features (toast bền; 409 version → nút "Tải lại").
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { FEATURE_KEYS } from "../api";

export function useFeatureFail() {
  const { t } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      const reload = {
        label: t("common.reload"),
        onClick: () => void qc.invalidateQueries({ queryKey: FEATURE_KEYS.all }),
      };
      const conflict = err instanceof ApiError && err.code === "VERSION_CONFLICT";
      notifyError(tr(spec.key, spec.params), conflict ? reload : undefined);
    },
    [t, tr, qc],
  );
}

/** Tên hiển thị của feature theo ngôn ngữ đang dùng. */
export function useFeatureName() {
  const { i18n } = useTranslation();
  return useCallback(
    (f: { name: { vi: string; en?: string } }) => pickLocalized(f.name, i18n.language),
    [i18n.language],
  );
}
