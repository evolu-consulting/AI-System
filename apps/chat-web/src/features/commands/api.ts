// HUB-FR-10 · `GET /commands` (menu `/`): nạp lười lần đầu gõ `/`, cache 5 phút. 403 coi như rỗng (không được cấp lệnh nào).
import { type CommandMenuResponse, CommandMenuResponseSchema } from "@ai/contracts/chat";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "~/lib/http";

export const COMMAND_MENU_STALE_MS = 5 * 60_000;

export async function fetchCommandMenu(): Promise<CommandMenuResponse> {
  try {
    return CommandMenuResponseSchema.parse(await api<unknown>("/commands"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return { items: [] };
    throw err;
  }
}

export function useCommandMenu(enabled: boolean) {
  return useQuery({
    queryKey: ["commands", "menu"],
    queryFn: fetchCommandMenu,
    enabled,
    staleTime: COMMAND_MENU_STALE_MS,
    retry: false, // lỗi hiện ngay + nút "Thử lại" (đúng 1 lần gọi lại)
  });
}
