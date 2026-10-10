// CHAT-AC-55 · FD9 · PF3: `process.notice` tới (`/me/stream`) ⇒ chèn notice mới vào đầu trang mới nhất của DM "Quy trình"
// và cập nhật `unread` (huy hiệu). Không gọi API — chỉ vá cache TanStack Query.
import type { ProcessInboxResponse, ProcessNoticeEventData } from "@ai/contracts/chat";
import type { QueryClient } from "@tanstack/react-query";
import { processKeys } from "../shared/keys";

type InboxData = { pages: ProcessInboxResponse[]; pageParams: unknown[] };

export function onProcessNotice(client: QueryClient, data: ProcessNoticeEventData): void {
  client.setQueryData<InboxData>(processKeys.inbox, (prev) => {
    if (!prev || prev.pages.length === 0) {
      // Chưa nạp trang nào: để query tự nạp; không dựng trang giả (thiếu `sender`/`next_cursor`).
      void client.invalidateQueries({ queryKey: processKeys.inbox });
      return prev;
    }
    const [first, ...rest] = prev.pages;
    const head = first as ProcessInboxResponse;
    const items = head.items.some((n) => n.id === data.notice.id)
      ? head.items.map((n) => (n.id === data.notice.id ? data.notice : n))
      : [data.notice, ...head.items];
    const nextFirst: ProcessInboxResponse = { ...head, items, unread: data.unread };
    return {
      ...prev,
      pages: [nextFirst, ...rest.map((p) => ({ ...p, unread: data.unread }))],
    };
  });
  // Notice thường kèm một task mới cần xử lý ⇒ làm tươi "Chờ tôi kiểm".
  void client.invalidateQueries({ queryKey: processKeys.tasks });
}
