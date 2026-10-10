// CHAT-AC-57 · HUB-FR-110/111 — nơi duy nhất PF2 gọi API (`POST /review-tasks/:id/{answer,forward}`).
import {
  type ForwardReviewTaskRequest,
  ForwardReviewTaskRequestSchema,
  type ReviewAnswerRequest,
  ReviewAnswerRequestSchema,
  type TaskDetail,
  TaskDetailSchema,
} from "@ai/contracts/chat";
import { api } from "~/lib/http";

const path = (id: string, verb: "answer" | "forward") =>
  `/review-tasks/${encodeURIComponent(id)}/${verb}`;

export async function answerTask(id: string, req: ReviewAnswerRequest): Promise<TaskDetail> {
  const body = ReviewAnswerRequestSchema.parse(req);
  return TaskDetailSchema.parse(await api<unknown>(path(id, "answer"), { method: "POST", body }));
}

export async function forwardTask(id: string, req: ForwardReviewTaskRequest): Promise<TaskDetail> {
  const body = ForwardReviewTaskRequestSchema.parse(req);
  return TaskDetailSchema.parse(await api<unknown>(path(id, "forward"), { method: "POST", body }));
}
