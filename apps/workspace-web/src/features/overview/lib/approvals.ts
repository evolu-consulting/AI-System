// contract-flow S4: HĐ chờ tôi duyệt (`GET /my-work` → `approvals[]`) — luật hiển thị thuần.
import type { MyWorkApproval } from "@ai/contracts";

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
