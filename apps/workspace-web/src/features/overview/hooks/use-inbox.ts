// CR-126 · «Việc của tôi»: MỘT hộp việc = `GET /my-work` (duyệt HĐ + ký) + `GET /me/review-tasks` (bước yêu cầu/quy trình/phiếu,
// gồm run con của «Quy trình mua hàng»). Task đã có ở danh sách duyệt HĐ không đếm lại. Trang và số đỏ menu dùng chung hook này.
import { useQuery } from "@tanstack/react-query";
import { fetchMyTasks, requestKeys } from "~/features/requests/api";
import { openTasks, type WaitingView, waitingView } from "~/features/requests/lib/waiting";
import { waitingOf } from "../lib/waiting";
import { useMyApprovals } from "./use-overview";

export function useInbox() {
  const work = useMyApprovals();
  const tasks = useQuery({
    queryKey: requestKeys.tasks,
    queryFn: ({ signal }) => fetchMyTasks(signal),
    retry: false,
  });
  const seen = new Set((work.data?.approvals ?? []).map((a) => a.task_id));
  const requests: WaitingView = waitingView(tasks, seen);
  const extra = openTasks(tasks.data, seen).length;
  // task duyệt thuộc một run ⇒ dòng mở trang yêu cầu của run (cùng dữ liệu đã tải, không truy vấn thêm).
  const runByTask = new Map(
    (tasks.data?.items ?? []).map((i) => [i.task.id, i.process_run.id] as const),
  );
  const itemByTask = new Map((tasks.data?.items ?? []).map((i) => [i.task.id, i] as const));
  return { work, requests, runByTask, itemByTask, count: waitingOf(work.data).total + extra };
}
