// ADM-FR-30 · báo lỗi chung của hành động ở danh sách Features (toast bền; 409 version do ConflictDialog xử lý nên không có nút "Tải lại").
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";

export function useFeatureFail() {
  const tr = useTr();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    },
    [tr],
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
