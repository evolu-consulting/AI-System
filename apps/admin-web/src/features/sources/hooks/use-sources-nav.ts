// ADM-FR-68 · điều hướng trang Nguồn: bộ lọc, công ty đang xem và drawer nằm trên URL (search params).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/sources");

export type SourcesPatch = Record<string, string | undefined>;

export function useSourcesNav() {
  const navigate = route.useNavigate();
  const patch = useCallback(
    (p: SourcesPatch) => void navigate({ search: (prev) => ({ ...prev, ...p }), replace: true }),
    [navigate],
  );
  const openDrawer = useCallback(
    (drawer: "new" | "edit" | "view", source?: string) =>
      void navigate({ search: (prev) => ({ ...prev, drawer, source }) }),
    [navigate],
  );
  const closeDrawer = useCallback(
    () =>
      void navigate({
        search: (prev) => ({ ...prev, drawer: undefined, source: undefined }),
        replace: true,
      }),
    [navigate],
  );
  return { patch, openDrawer, closeDrawer };
}
