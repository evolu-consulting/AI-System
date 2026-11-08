// contract-flow S4: HĐ chờ tôi duyệt (`GET /my-work` → `approvals[]`) — luật hiển thị thuần.
import type { MyWorkApproval } from "@ai/contracts/pack-contracts";

export type ApprovalRow = {
  taskId: string;
  contractId: string;
  title: string;
  stage: string;
  due: { at: string; late: boolean } | null;
  escalated: boolean;
};

/** Tên HĐ: "số · tên"; thiếu cả hai ⇒ null (UI dùng chữ mặc định). */
export const approvalTitle = (a: Pick<MyWorkApproval, "contract_number" | "contract_title">) =>
  [a.contract_number, a.contract_title].filter((x) => x && x.trim() !== "").join(" · ") || null;

/** Sắp theo hạn gần nhất trước (không hạn ⇒ cuối); `now` (ms) để test không phụ thuộc đồng hồ. */
export function approvalRows(
  list: readonly MyWorkApproval[] | undefined,
  now: number,
): ApprovalRow[] {
  const rows = (list ?? []).map((a) => ({
    taskId: a.task_id,
    contractId: a.contract_id,
    title: approvalTitle(a) ?? "",
    stage: a.stage_name,
    due: a.due_at ? { at: a.due_at, late: Date.parse(a.due_at) < now } : null,
    escalated: a.escalated,
  }));
  return rows.sort(
    (x, y) =>
      (x.due ? Date.parse(x.due.at) : Number.POSITIVE_INFINITY) -
      (y.due ? Date.parse(y.due.at) : Number.POSITIVE_INFINITY),
  );
}

/** CR-126 · nơi mở của dòng duyệt: task thuộc một run quy trình/yêu cầu ⇒ trang yêu cầu của run (nơi có nút duyệt thật);
 *  không có run ⇒ thẻ HĐ. `runByTask` = review_tasks.id → process_run.id, dựng cùng lượt từ `GET /me/review-tasks` (không truy vấn thêm). */
export type ApprovalTarget =
  | { to: "/contracts/requests/$runId"; params: { runId: string } }
  | { to: "/contracts/c/$id"; params: { id: string } };

export function approvalTarget(
  row: Pick<ApprovalRow, "taskId" | "contractId">,
  runByTask?: ReadonlyMap<string, string>,
): ApprovalTarget {
  const runId = runByTask?.get(row.taskId);
  return runId
    ? { to: "/contracts/requests/$runId", params: { runId } }
    : { to: "/contracts/c/$id", params: { id: row.contractId } };
}
