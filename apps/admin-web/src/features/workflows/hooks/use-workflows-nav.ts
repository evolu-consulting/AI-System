// ADM-FR-14 · điều hướng của trang Workflows: bộ lọc và trang nằm trên URL (search params).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/workflows/");

export type WorkflowsPatch = Record<string, string | number | undefined>;

export function useWorkflowsNav() {
  const navigate = route.useNavigate();
  /** Đổi bộ lọc → về trang 1 (trừ khi đổi chính `page`). */
  return useCallback(
    (p: WorkflowsPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
}
