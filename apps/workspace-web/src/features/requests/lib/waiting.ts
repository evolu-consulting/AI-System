// CR-126 · cr126-child-task-visible-2 · «Việc chờ tôi» trên /contracts/requests: chỉ nói «chưa có việc» khi danh sách ĐÃ tải xong và
// rỗng. Đang tải ⇒ khung chờ; lỗi ⇒ báo lỗi (trước đây cả hai hiện «chưa có việc» ⇒ người dùng và e2e tưởng không có việc).
import type { ReviewTaskListResponse } from "@ai/contracts/chat";

type Item = ReviewTaskListResponse["items"][number];
export type WaitingView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "list"; items: Item[] };

/** Việc mở mà tôi làm được (`open && can_act`) theo trạng thái truy vấn `GET /me/review-tasks`. */
export function waitingView(q: {
  isPending: boolean;
  isError: boolean;
  data?: ReviewTaskListResponse;
}): WaitingView {
  if (q.isPending) return { kind: "loading" };
  if (q.isError || !q.data) return { kind: "error" };
  const items = q.data.items.filter((i) => i.task.status === "open" && i.task.can_act);
  return items.length === 0 ? { kind: "empty" } : { kind: "list", items };
}
