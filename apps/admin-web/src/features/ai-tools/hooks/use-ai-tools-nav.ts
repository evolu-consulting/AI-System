// CR-121 R6 · c16 · bộ lọc, công cụ đang mở ngăn và thông báo nằm trên URL (`/ai-tools?status=&kind=&q=&tool=&notice=`).
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";

const route = getRouteApi("/_authed/ai-tools");

export type AiToolsPatch = Partial<
  Record<"status" | "kind" | "q" | "tool" | "notice", string | undefined>
>;

export function useAiToolsNav() {
  const navigate = route.useNavigate();
  return useCallback(
    (p: AiToolsPatch) =>
      void navigate({
        // biome-ignore lint/suspicious/noExplicitAny: giá trị đã qua parse ở validateSearch của route
        search: (prev) => ({ ...prev, ...p }) as any,
        replace: true,
      }),
    [navigate],
  );
}
