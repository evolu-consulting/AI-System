// CHAT-AC-53 · mutation `POST /review-tasks/:id/decision` (Đạt / Chưa đạt). Thành công ⇒ invalidate view + "Chờ tôi kiểm".
// Xử lý toast/lỗi `REVIEW_TASK_CLOSED` để component gọi (thread: trong `submit` của thẻ; inline: tại chỗ).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { processKeys } from "../../shared/keys";
import { postReviewDecision } from "../api";

export type ReviewVars = { taskId: string; result: "pass" | "fail"; feedback?: string };

export function useReviewDecision(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ReviewVars) =>
      postReviewDecision(v.taskId, { result: v.result, feedback: v.feedback }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: processKeys.run(runId), refetchType: "active" });
      void qc.invalidateQueries({ queryKey: processKeys.tasks });
    },
  });
}
