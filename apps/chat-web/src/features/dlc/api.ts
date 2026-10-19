// DLC-R11 · DLC-R12 · gọi Hub `/dlc/*` (nơi duy nhất của feature dlc): Workspaces (hội thoại AI SDLC) + Process của run.
import type { DlcProcessResponse, DlcWorkspacesResponse } from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";

export const DLC_WORKSPACES_KEY = "dlc-workspaces";
export const DLC_PROCESS_KEY = "dlc-process";

export function listWorkspaces(signal?: AbortSignal): Promise<DlcWorkspacesResponse> {
  return api<DlcWorkspacesResponse>("/dlc/workspaces", { signal });
}

export function getProcess(convId: string, signal?: AbortSignal): Promise<DlcProcessResponse> {
  return api<DlcProcessResponse>(`/dlc/conversations/${encodeURIComponent(convId)}/process`, {
    signal,
  });
}
