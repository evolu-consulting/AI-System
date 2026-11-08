// CR-126 · «Việc của tôi» (/contracts/approvals, phần việc yêu cầu/quy trình): chỉ nói «chưa có việc» khi danh sách ĐÃ tải xong và
// rỗng. Đang tải ⇒ khung chờ; lỗi ⇒ báo lỗi (trước đây cả hai hiện «chưa có việc» ⇒ người dùng và e2e tưởng không có việc).
import type { ReviewTaskListResponse } from "@ai/contracts/chat";

type Item = ReviewTaskListResponse["items"][number];
export type WaitingView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "list"; items: Item[] };

/** Việc mở mà tôi làm được (`open && can_act`); `skip` = id task đã hiện ở danh sách khác (HĐ duyệt) ⇒ không đếm hai lần. */
export function openTasks(
  data: ReviewTaskListResponse | undefined,
  skip: ReadonlySet<string> = new Set(),
): Item[] {
  return (data?.items ?? []).filter(
    (i) => i.task.status === "open" && i.task.can_act && !skip.has(i.task.id),
  );
}

/** Trạng thái danh sách theo truy vấn `GET /me/review-tasks`. */
export function waitingView(
  q: { isPending: boolean; isError: boolean; data?: ReviewTaskListResponse },
  skip?: ReadonlySet<string>,
): WaitingView {
  if (q.isPending) return { kind: "loading" };
  if (q.isError || !q.data) return { kind: "error" };
  const items = openTasks(q.data, skip);
  return items.length === 0 ? { kind: "empty" } : { kind: "list", items };
}
