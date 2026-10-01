// ADM-FR-50 · điều hướng của trang Secrets: bộ lọc, trang và drawer nằm trên URL (search params).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/secrets");

export type SecretsPatch = Record<string, string | number | boolean | undefined>;

export function useSecretsNav() {
  const navigate = route.useNavigate();
  /** Đổi bộ lọc → về trang 1 (trừ khi đổi chính `page`). */
  const patch = useCallback(
    (p: SecretsPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
  const openDrawer = useCallback(
    (drawer: "new" | "replace" | "note", secret?: string) =>
      void navigate({ search: (prev) => ({ ...prev, drawer, secret }) }),
    [navigate],
  );
  const closeDrawer = useCallback(
    () =>
      void navigate({
        search: (prev) => ({ ...prev, drawer: undefined, secret: undefined }),
        replace: true,
      }),
    [navigate],
  );
  return { patch, openDrawer, closeDrawer };
}
