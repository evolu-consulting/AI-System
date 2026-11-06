// CR-121 R6 · c16 · dữ liệu hiển thị của trang: đọc một lượt, lọc/đếm/cắt "Xem thêm" ở client (≤ 200 công cụ).
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAiToolUsage } from "../api";
import { FIRST_PAGE, filterTools, MORE_STEP, sliceShown, toolCounts } from "../lib/ai-tools";
import { useAiToolsNav } from "./use-ai-tools-nav";

const route = getRouteApi("/_authed/ai-tools");

export function useAiToolsView() {
  const { status, kind, q, tool, notice, secret } = route.useSearch();
  const patch = useAiToolsNav();
  const usage = useAiToolUsage();
  const [shown, setShown] = useState(FIRST_PAGE);
  const items = usage.data?.items;
  const filters = useMemo(() => ({ status, kind, q, secret }), [status, kind, q, secret]);
  const filtered = useMemo(
    () => (items ? filterTools(items, filters) : undefined),
    [items, filters],
  );
  const counts = useMemo(() => (items ? toolCounts(items) : undefined), [items]);
  return {
    usage,
    filters,
    counts,
    notice,
    total: filtered?.length ?? 0,
    page: filtered ? sliceShown(filtered, shown) : undefined,
    active: items?.find((x) => x.id === tool),
    activeId: tool,
    more: () => setShown((n) => n + MORE_STEP),
    /** Đổi bộ lọc ⇒ quay về trang đầu của "Xem thêm". */
    refilter: (p: Parameters<typeof patch>[0]) => {
      setShown(FIRST_PAGE);
      patch(p);
    },
    patch,
  };
}
