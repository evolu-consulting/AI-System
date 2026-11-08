// ADM-FR-74 · báo lỗi API bằng toast bền (401 để modal phiên hết hạn lo).

import { notifyError } from "@ai/web-kit/ui/toast";
import { useCallback } from "react";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";

export function useReportError(): (err: unknown) => void {
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
