// ADM-FR-62 · điều hướng của trang Groups: bộ lọc nằm trên URL (đổi bộ lọc bỏ `page`).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/groups/");

export type GroupsSearchPatch = Record<string, string | number | undefined>;

export function useGroupsNav() {
  const navigate = route.useNavigate();
  return useCallback(
    (p: GroupsSearchPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
}
