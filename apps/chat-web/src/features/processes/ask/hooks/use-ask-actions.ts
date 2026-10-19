// CHAT-AC-57 · HUB-FR-110/111 — mutation `answer` / `forward`. Mọi kết quả (kể cả 409 `REVIEW_TASK_CLOSED`) → làm mới view/danh sách.
import type { ForwardReviewTaskRequest, ReviewAnswerRequest } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { processKeys } from "../../shared/keys";
import { answerTask, forwardTask } from "../api";

export const isClosedError = (e: unknown): boolean =>
  e instanceof ApiError && e.code === "REVIEW_TASK_CLOSED";

export const codeOf = (e: unknown): string | undefined =>
  e instanceof ApiError ? e.code : undefined;

export function useAnswerTask(runId: string, taskId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: processKeys.run(runId) });
    void qc.invalidateQueries({ queryKey: processKeys.tasks });
  };
  return useMutation({
    mutationFn: (req: ReviewAnswerRequest) => answerTask(taskId, req),
    onSuccess: refresh,
    onError: (e) => isClosedError(e) && refresh(),
  });
}

export function useForwardTask(taskId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: processKeys.all });
  return useMutation({
    mutationFn: (req: ForwardReviewTaskRequest) => forwardTask(taskId, req),
    onSuccess: refresh,
    onError: (e) => isClosedError(e) && refresh(),
  });
}
