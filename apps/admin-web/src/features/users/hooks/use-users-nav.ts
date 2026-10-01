// ADM-FR-04 · điều hướng của trang Users: mọi bộ lọc và drawer nằm trên URL (search params).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/users");

export type SearchPatch = Record<string, string | number | undefined>;

export function useUsersNav() {
  const navigate = route.useNavigate();
  /** Đổi bộ lọc → về trang 1 (trừ khi đổi chính `page`). */
  const patch = useCallback(
    (p: SearchPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
  const onEdit = useCallback(
    (u: { id: string }) =>
      void navigate({ search: (prev) => ({ ...prev, drawer: "edit", user: u.id }) }),
    [navigate],
  );
  const openCreate = useCallback(
    () => void navigate({ search: (prev) => ({ ...prev, drawer: "new" }) }),
    [navigate],
  );
  const closeDrawer = useCallback(
    () =>
      void navigate({
        search: (prev) => ({ ...prev, drawer: undefined, user: undefined }),
        replace: true,
      }),
    [navigate],
  );
  return { patch, onEdit, openCreate, closeDrawer };
}
