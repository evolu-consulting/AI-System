// HUB-FR-91 · `GET /agents` (menu `@`): nạp lười lần đầu gõ `@`, cache 60 s (Studio sửa thấy sau ≤ 1 phút, CR-044). 403 coi như rỗng.
import { type AgentMenuResponse, AgentMenuResponseSchema } from "@ai/contracts/chat";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "~/lib/http";

export const AGENT_MENU_STALE_MS = 60_000;

export async function fetchAgentMenu(): Promise<AgentMenuResponse> {
  try {
    return AgentMenuResponseSchema.parse(await api<unknown>("/agents"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return { items: [] };
    throw err;
  }
}

export function useAgentMenu(enabled: boolean) {
  return useQuery({
    queryKey: ["agents", "menu"],
    queryFn: fetchAgentMenu,
    enabled,
    staleTime: AGENT_MENU_STALE_MS,
    retry: false, // lỗi hiện ngay + nút "Thử lại"
  });
}
