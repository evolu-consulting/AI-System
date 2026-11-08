// CR-125 · cr125-request-steps · luật thuần của trang yêu cầu: cây lượt (lượt gốc + Quy trình con lồng nhau) từ `StartRequestView.steps`.
import type { RequestStepNode } from "@ai/contracts/hub-admin";

/** Mọi lượt trong cây theo thứ tự hiển thị (cha trước, con theo thứ tự bắt đầu). */
export function flattenSteps(n: RequestStepNode): RequestStepNode[] {
  return [n, ...n.children.flatMap(flattenSteps)];
}

/** Lượt đầu tiên (theo thứ tự hiển thị) mà người xem có việc phải làm; không có ⇒ null. */
export function firstActionable(root: RequestStepNode): RequestStepNode | null {
  return flattenSteps(root).find((n) => n.flow.tasks.length > 0) ?? null;
}

/** Trang yêu cầu mở từ «Chờ tôi duyệt» của lượt CON ⇒ chuyển sang trang lượt gốc, lấy lượt con làm điểm nhìn; ngược lại null. */
export function redirectToRoot(
  runId: string,
  rootRunId: string | null,
): { runId: string; focus: string } | null {
  return rootRunId && rootRunId !== runId ? { runId: rootRunId, focus: runId } : null;
}
