// feedback · `/admin/feedback*` (tenant_admin: tenant mình; platform_admin: tất cả) dưới dạng hook TanStack Query.
import type {
  FeedbackItem,
  FeedbackKind,
  FeedbackListResponse,
  FeedbackStatus,
  FeedbackUpdateRequest,
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
