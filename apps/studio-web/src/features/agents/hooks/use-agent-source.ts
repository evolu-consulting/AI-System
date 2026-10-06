// HUB-FR-60 · H4a-R12 · agent nguồn cho editor: sửa (`/agents/$id`) hoặc nhân bản (`?from=`). Chỉ lấy lần tải đầu của lần
// mount (lần refetch sau lưu không đè nháp) — truy vấn `gcTime: 0` nên không có bản cũ trong cache khi quay lại.
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { agentQuery } from "../api";

export function useAgentSource(id: string | undefined) {
  const q = useQuery({ ...agentQuery(id ?? ""), enabled: Boolean(id) });
  const first = useRef(q.data);
  if (q.data && !first.current) first.current = q.data;
  return {
    agent: first.current,
    pending: Boolean(id) && !first.current && q.isPending,
    error: first.current ? null : q.error,
    retry: () => void q.refetch(),
  };
}
