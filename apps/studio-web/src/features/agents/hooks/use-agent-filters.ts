// HUB-FR-60 · H4a-R11 · bộ lọc trên URL: ô tìm cập nhật ngay cho lọc client, URL + gọi máy chủ debounce 300 ms.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type AgentFilters, type AgentSearch, toFilters } from "../lib/filters";

const route = getRouteApi("/_authed/agents/");

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useAgentFilters() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const debouncedQ = useDebounced(q, 300);

  const go = (next: AgentSearch) => void navigate({ to: "/agents", search: next, replace: true });

  // Đẩy ô tìm lên URL khi đã dừng gõ (debounced === q); tránh ghi đè khi vừa "Xoá bộ lọc".
  useEffect(() => {
    if (debouncedQ === q && q.trim() !== (search.q ?? "")) {
      void navigate({
        to: "/agents",
        search: (prev: AgentSearch) => ({ ...prev, q: debouncedQ.trim() || undefined }),
        replace: true,
      });
    }
  }, [debouncedQ, q, search.q, navigate]);

  const filters = useMemo<AgentFilters>(() => ({ ...toFilters(search), q }), [search, q]);
  const serverFilters = useMemo<AgentFilters>(
    () => ({ ...toFilters(search), q: debouncedQ }),
    [search, debouncedQ],
  );

  return {
    filters,
    serverFilters,
    setQ,
    setRuntime: (runtime: AgentFilters["runtime"]) => go({ ...search, runtime }),
    setStatus: (status: AgentFilters["status"]) => go({ ...search, status }),
    clear: () => {
      setQ("");
      go({});
    },
  };
}
