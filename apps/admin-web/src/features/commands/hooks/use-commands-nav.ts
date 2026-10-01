// ADM-FR-20 · điều hướng của trang Commands: bộ lọc và trang nằm trên URL (search params).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/commands/");

export type CommandsPatch = Record<string, string | number | undefined>;

export function useCommandsNav() {
  const navigate = route.useNavigate();
  /** Đổi bộ lọc → về trang 1 (trừ khi đổi chính `page`). */
  return useCallback(
    (p: CommandsPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
}
