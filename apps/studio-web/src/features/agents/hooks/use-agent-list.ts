// HUB-FR-60 · H4a-R11 · danh sách agent: lọc client trên ≤ 200 dòng; `truncated` ⇒ lọc phía máy chủ (debounce ở caller).
import type { AgentListItem } from "@ai/contracts/studio";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { agentsQuery } from "../api";
import { type AgentFilters, matchesFilters, toServerParams } from "../lib/filters";
import { overlapByAgent } from "../lib/overlap";

/** `serverFilters`: bộ lọc đã debounce, chỉ dùng khi danh sách gốc bị cắt. */
export function useAgentList(filters: AgentFilters, serverFilters: AgentFilters) {
  const base = useQuery(agentsQuery());
  const truncated = base.data?.truncated === true;
  const server = useQuery({
    ...agentsQuery(toServerParams(serverFilters)),
    enabled: truncated,
    placeholderData: (prev) => prev,
  });

  const source = truncated ? server.data?.items : base.data?.items;
  const items = useMemo<AgentListItem[]>(
    () => (truncated ? (source ?? []) : (source ?? []).filter((a) => matchesFilters(a, filters))),
    [source, truncated, filters],
  );
  // Trùng ý tính trên mọi agent đã biết (gốc ∪ kết quả máy chủ) để không mất đối tượng so sánh.
  const overlaps = useMemo(() => {
    const pool = new Map<string, AgentListItem>();
    for (const a of [...(base.data?.items ?? []), ...(server.data?.items ?? [])]) pool.set(a.id, a);
    return overlapByAgent([...pool.values()]);
  }, [base.data, server.data]);

  const active = truncated ? server : base;
  return {
    items,
    all: base.data?.items ?? [],
    overlaps,
    truncated,
    isPending: base.isPending || (truncated && server.isPending),
    error: active.error ?? base.error,
    refetch: () => {
      void base.refetch();
      if (truncated) void server.refetch();
    },
  };
}
