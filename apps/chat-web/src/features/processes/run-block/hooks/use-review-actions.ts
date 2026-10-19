// CHAT-AC-53 · CHAT-AC-60 · mutation `POST /review-tasks/:id/decision` (Đạt / Chưa đạt, + `back_to_step`). Thành công ⇒ invalidate
// view + "Chờ tôi kiểm". Lỗi "view cũ" (409 đóng / 422 đích quay lại) ⇒ cũng làm tươi. Toast/lỗi do component gọi xử lý.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { processKeys } from "../../shared/keys";
import { postReviewDecision } from "../api";
import { isStaleReviewError } from "../lib/review-error";

export type ReviewVars = {
  taskId: string;
  result: "pass" | "fail" | "reject"; // N2-FR-02 · HD3: Từ chối (lý do bắt buộc)
  feedback?: string;
  /** P-b2 · 0-based; chỉ với `fail`. */
  backToStep?: number;
};

export function useReviewDecision(runId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: processKeys.run(runId), refetchType: "active" });
    void qc.invalidateQueries({ queryKey: processKeys.tasks });
  };
  return useMutation({
    mutationFn: (v: ReviewVars) =>
      postReviewDecision(v.taskId, {
        result: v.result,
        feedback: v.feedback,
        back_to_step: v.backToStep,
      }),
    onSuccess: refresh,
    onError: (err) => {
      if (isStaleReviewError(err)) refresh();
    },
  });
}
