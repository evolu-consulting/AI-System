// ADM-FR-30 · điều hướng của trang Features: bộ lọc và trang nằm trên URL (search params).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/features/");

export type FeaturesPatch = Record<string, string | number | undefined>;

export function useFeaturesNav() {
  const navigate = route.useNavigate();
  /** Đổi bộ lọc → về trang 1 (trừ khi đổi chính `page`). */
  return useCallback(
    (p: FeaturesPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
}
