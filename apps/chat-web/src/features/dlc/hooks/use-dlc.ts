// DLC-R11 · DLC-R12 · query Workspaces (làm mới 30 s) và Process (2 s khi run đang chạy, dừng khi run xong).
import { useQuery } from "@tanstack/react-query";
import { DLC_PROCESS_KEY, DLC_WORKSPACES_KEY, getProcess, listWorkspaces } from "../api";

const FINAL = new Set(["green", "escalated"]);
export const WORKSPACES_REFRESH_MS = 30_000;
export const PROCESS_REFRESH_MS = 2_000;

export function useDlcWorkspaces() {
  return useQuery({
    queryKey: [DLC_WORKSPACES_KEY],
    queryFn: ({ signal }) => listWorkspaces(signal),
    refetchInterval: WORKSPACES_REFRESH_MS,
  });
}

/** Hội thoại có dự án AI SDLC (nút "Xem Process" chỉ hiện khi true). */
export function useIsDlcConversation(convId: string): boolean {
  const { data } = useDlcWorkspaces();
  return data?.items.some((w) => w.conversation_id === convId) ?? false;
}

export function useDlcProcess(convId: string, enabled: boolean) {
  return useQuery({
    queryKey: [DLC_PROCESS_KEY, convId],
    queryFn: ({ signal }) => getProcess(convId, signal),
    enabled,
    refetchInterval: (q) => {
      const st = q.state.data?.run_state;
      return st && FINAL.has(st) ? false : PROCESS_REFRESH_MS;
    },
  });
}
