// feedback · `/admin/feedback*` (tenant_admin: tenant mình; platform_admin: tất cả) dưới dạng hook TanStack Query.
import type {
  FeedbackItem,
  FeedbackKind,
  FeedbackListResponse,
  FeedbackStatus,
  FeedbackUpdateRequest,
  TrelloCheckResponse,
  TrelloConfigSaveRequest,
  TrelloConfigView,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiResponse } from "@/lib/http";

export type FeedbackFilters = {
  tenant_id?: string;
  app?: string;
  kind?: FeedbackKind;
  status?: FeedbackStatus;
  offset: number;
};

export const PAGE_SIZE = 25;
const KEY = ["feedback"] as const;

export const useFeedbackList = (f: FeedbackFilters) =>
  useQuery({
    queryKey: [...KEY, f],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<FeedbackListResponse>("/admin/feedback", {
        query: { ...f, limit: PAGE_SIZE },
      }),
  });

export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: FeedbackUpdateRequest }) =>
      api<FeedbackItem>(`/admin/feedback/${encodeURIComponent(v.id)}`, {
        method: "PATCH",
        body: v.body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// trello-config-ui · `/admin/integrations/trello*` (platform_admin). Key/token chỉ có ở body request; mutation `gcTime: 0`.
const TRELLO = "/admin/integrations/trello";
const TRELLO_KEY = ["integrations", "trello"] as const;

export const useTrelloConfig = (enabled: boolean) =>
  useQuery({
    queryKey: TRELLO_KEY,
    enabled,
    queryFn: () => api<TrelloConfigView>(TRELLO),
  });

export function useSaveTrello() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: TrelloConfigSaveRequest) =>
      api<TrelloConfigView>(TRELLO, { method: "PUT", body }),
    onSuccess: (v) => qc.setQueryData(TRELLO_KEY, v),
  });
}

export function useClearTrello() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>(TRELLO, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRELLO_KEY }),
  });
}

export const useCheckTrello = () =>
  useMutation({
    mutationFn: () => api<TrelloCheckResponse>(`${TRELLO}/check`, { method: "POST" }),
  });

/** Tải tệp đính kèm (Bearer) về máy. */
export async function downloadAttachment(feedbackId: string, fileId: string, name: string) {
  const res = await apiResponse(
    `/admin/feedback/${encodeURIComponent(feedbackId)}/files/${encodeURIComponent(fileId)}`,
  );
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
