// ADM-FR-74 · điều hướng của trang Đối tác: bộ lọc và công ty đang mở nằm trên URL (đổi bộ lọc bỏ `page`).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/partners");

export type PartnersSearchPatch = Record<string, string | number | undefined>;

export function usePartnersNav() {
  const navigate = route.useNavigate();
  return useCallback(
    (p: PartnersSearchPatch, keepPage = false) =>
      void navigate({
        search: (prev) => ({ ...prev, ...p, ...(keepPage ? {} : { page: undefined }) }),
        replace: true,
      }),
    [navigate],
  );
}
