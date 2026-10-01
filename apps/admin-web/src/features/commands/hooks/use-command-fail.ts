// ADM-FR-20 · báo lỗi chung của hành động ở danh sách Commands (toast bền; 409 version do ConflictDialog xử lý nên không có nút "Tải lại").
import { useCallback } from "react";
import { notifyError } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";

export function useCommandFail() {
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
