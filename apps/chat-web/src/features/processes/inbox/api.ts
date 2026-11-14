// HUB-FR-112 · CHAT-AC-54…55 · PF3 (F3): nơi duy nhất PF3 gọi `/me/review-tasks`, `/me/process-inbox*`.
// "Chờ tôi kiểm" (review-tasks) + DM "Quy trình" (process-inbox, phân trang) + đánh dấu đã đọc.
import {
  type MarkProcessInboxReadResponse,
  MarkProcessInboxReadResponseSchema,
  type ProcessInboxResponse,
  ProcessInboxResponseSchema,
  type ReviewTaskListResponse,
  ReviewTaskListResponseSchema,
} from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { processKeys } from "../shared/keys";

const REVIEW_TASKS_LIMIT = 50;
const INBOX_LIMIT = 50;

async function fetchReviewTasks(
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ReviewTaskListResponse> {
  return ReviewTaskListResponseSchema.parse(
    await api<unknown>("/me/review-tasks", {
      query: { status: "open", limit: REVIEW_TASKS_LIMIT, cursor },
      signal,
    }),
  );
}

/** FD8 · "Chờ tôi kiểm": task mở của tôi. Realtime `review_task.*` invalidate key này (shared, B0). */
export function useReviewTasks(enabled = true) {
  // CR-151: tải dần theo `next_cursor` (trang 50); `data` giữ dạng phẳng {items, open_count} cho nơi dùng cũ.
  return useInfiniteQuery({
    queryKey: processKeys.tasks,
    queryFn: ({ pageParam, signal }) => fetchReviewTasks(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    select: (d) => ({
      items: d.pages.flatMap((p) => p.items),
      open_count: d.pages[0]?.open_count ?? 0,
    }),
    enabled,
    staleTime: 10_000,
  });
}

async function fetchInbox(
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ProcessInboxResponse> {
  return ProcessInboxResponseSchema.parse(
    await api<unknown>("/me/process-inbox", {
      query: { limit: INBOX_LIMIT, cursor },
      signal,
    }),
  );
}

/** DM "Quy trình": trang mới→cũ từ server (`next_cursor` = trang cũ hơn). FE hiển thị cũ→mới. */
export function useInbox(enabled = true) {
  return useInfiniteQuery({
    queryKey: processKeys.inbox,
    queryFn: ({ pageParam, signal }) => fetchInbox(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    staleTime: 10_000,
  });
}

async function markInboxRead(upToId: string): Promise<MarkProcessInboxReadResponse> {
  return MarkProcessInboxReadResponseSchema.parse(
    await api<unknown>("/me/process-inbox/read", { method: "POST", body: { up_to_id: upToId } }),
  );
}

/** `POST /me/process-inbox/read` — cập nhật `unread` của mọi trang đã nạp + đánh dấu `read` các notice ≤ `up_to_id`. */
export function useMarkInboxRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (upToId: string) => markInboxRead(upToId),
    onSuccess: (res) => {
      qc.setQueryData<{ pages: ProcessInboxResponse[]; pageParams: unknown[] }>(
        processKeys.inbox,
        (prev) =>
          prev
            ? {
                ...prev,
                pages: prev.pages.map((p) => ({
                  ...p,
                  unread: res.unread,
                  items: p.items.map((n) => ({ ...n, read: true })),
                })),
              }
            : prev,
      );
    },
  });
}
