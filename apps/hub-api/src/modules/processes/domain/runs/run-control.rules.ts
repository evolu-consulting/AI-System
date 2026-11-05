// CR-121 · R-1 · luật thuần điều khiển lượt chạy (Dừng · Chạy lại bước · Chạy lại cả lượt): AI được làm, ở trạng thái nào.
// Quyền: platform_admin mọi tenant; tenant_admin CHỈ tenant mình và KHÔNG chạy lại bước; thành viên không thao tác.
import type { ProcessRunStatus, StageRunStatus } from "../types";
import { isTerminal } from "./run-state.core";

export type RunControlOp = "stop" | "rerun_step" | "rerun";
export type ControlActor = { role: "platform_admin" | "tenant_admin" | "member"; tenantId: string };

/** Vai được phép thao tác (chưa xét tenant của run — tenant khác ⇒ 404 ở service). */
export function roleAllows(op: RunControlOp, role: ControlActor["role"]): boolean {
  if (role === "platform_admin") return true;
  return role === "tenant_admin" && op !== "rerun_step";
}

/** Dừng: run chưa kết thúc (đang chạy, đang thử lại, chờ duyệt/trả lời/hẹn, cần quyết định). */
export const canStop = (s: ProcessRunStatus): boolean => !isTerminal(s);

/** Đã dừng rồi ⇒ bấm lại trả cùng kết quả (không ghi thêm). */
export const alreadyStopped = (s: ProcessRunStatus): boolean => s === "cancelled";

/** Bước "lỗi" hoặc "đã xong" chạy lại được (lỗi = cần quyết định / hỏng / đang chờ thử lại). */
const RERUNNABLE_STAGE: ReadonlySet<StageRunStatus> = new Set([
  "done",
  "failed",
  "needs_decision",
  "waiting_timer",
]);
/** Run đã dừng/hết hạn ⇒ không chạy lại bước (dùng "Chạy lại cả lượt"); xong/hỏng/đang chạy ⇒ được. */
const RERUN_STEP_RUN_BLOCKED: ReadonlySet<ProcessRunStatus> = new Set(["cancelled", "expired"]);

export function canRerunStep(run: ProcessRunStatus, stage: StageRunStatus | null): boolean {
  if (RERUN_STEP_RUN_BLOCKED.has(run)) return false;
  return stage !== null && RERUNNABLE_STAGE.has(stage);
}

/** Chạy lại cả lượt: chỉ run đã kết thúc (lỗi / xong / đã dừng / hết hạn). Run gắn bản ghi gói ⇒ gói tự mở lại lượt duyệt. */
export function canRerunRun(run: ProcessRunStatus, packBound: boolean): boolean {
  return !packBound && isTerminal(run);
}

/** Nhãn lý do (vi) ghi vào góp ý của bước chạy lại (`process_back_events.feedback` 1..4000 ký tự). */
const REASON_VI: Record<string, string> = {
  sent_by_mistake: "Gửi nhầm",
  needs_edit: "Cần sửa nội dung",
  bad_data: "Dữ liệu sai",
  other: "Khác",
};
export const rerunStepFeedback = (reason: string): string =>
  `Quản trị chạy lại bước (lý do: ${REASON_VI[reason] ?? "Khác"})`;
