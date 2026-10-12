// HUB-FR-112 · D16 · dựng `UserEvent` quy trình (plan-contract §5): người gọi tính người nhận TRONG tx, phát SAU COMMIT
// qua `publishUserEvents`. Thuần. Người nhận trùng bị gộp; rỗng ⇒ không sự kiện.
import type {
  ProcessNoticeEventData,
  ProcessRunStatus,
  ReviewTaskCreatedEventData,
  TaskResult,
} from "@ai/contracts/chat";
import type { UserEvent } from "../../../lib/user-stream";

const uniq = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Người bắt đầu + thành viên phòng nguồn + assignee task open (khối gốc/`/runs/:id` cập nhật trạng thái sống). */
export function processUpdated(
  userIds: readonly string[],
  run: { id: string; status: ProcessRunStatus; stageIdx: number; step?: number },
): UserEvent[] {
  const ids = uniq(userIds);
  if (ids.length === 0) return [];
  // P-b2 · `step` = bước hiện tại (vắng ⇒ client giữ giá trị cũ).
  const data = {
    process_run_id: run.id,
    status: run.status,
    stage_idx: run.stageIdx,
    ...(run.step !== undefined && { step: run.step }),
  };
  return [{ userIds: ids, event: "process.updated", data }];
}

export function reviewTaskCreated(
  userIds: readonly string[],
  data: ReviewTaskCreatedEventData,
): UserEvent[] {
  const ids = uniq(userIds);
  return ids.length === 0 ? [] : [{ userIds: ids, event: "review_task.created", data }];
}

export function reviewTaskClosed(
  userIds: readonly string[],
  task: { id: string; result: TaskResult },
): UserEvent[] {
  const ids = uniq(userIds);
  const data = { task_id: task.id, result: task.result };
  return ids.length === 0 ? [] : [{ userIds: ids, event: "review_task.closed", data }];
}

/** Mỗi notice chỉ cho chủ notice. */
export function processNotice(userId: string, data: ProcessNoticeEventData): UserEvent[] {
  return [{ userIds: [userId], event: "process.notice", data }];
}
