// CHAT-AC-52 · CHAT-AC-53 · nơi duy nhất PF1 (F2) gọi API của khối/thẻ: list run hội thoại, cổng kiểm, quyết định, huỷ.
import {
  CreateProcessRunResponseSchema,
  type DecideProcessRunRequest,
  DecideProcessRunRequestSchema,
  type ProcessRunListResponse,
  ProcessRunListResponseSchema,
  type ProcessRunSummary,
  type ReviewDecisionRequest,
  ReviewDecisionRequestSchema,
  ReviewTaskResponseSchema,
  type TaskDetail,
} from "@ai/contracts/chat";
import { api } from "~/lib/http";

const runPath = (id: string) => `/process-runs/${encodeURIComponent(id)}`;
const reviewPath = (id: string) => `/review-tasks/${encodeURIComponent(id)}`;

/** Thẻ run của một hội thoại Hỏi AI (D14): `GET /process-runs?conversation_id=&scope=mine`. */
export async function listConversationRuns(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ProcessRunListResponse> {
  return ProcessRunListResponseSchema.parse(
    await api<unknown>("/process-runs", {
      query: { conversation_id: conversationId, scope: "mine" },
      signal,
    }),
  );
}

/** `POST /review-tasks/:id/decision` (Đạt / Chưa đạt + góp ý). 200 ⇒ `TaskDetail` đã đóng. */
export async function postReviewDecision(
  taskId: string,
  body: ReviewDecisionRequest,
): Promise<TaskDetail> {
  return ReviewTaskResponseSchema.parse(
    await api<unknown>(`${reviewPath(taskId)}/decision`, {
      method: "POST",
      body: ReviewDecisionRequestSchema.parse(body),
    }),
  );
}

/** `POST /process-runs/:id/decide` (Cần người quyết). 200/201 ⇒ tóm tắt run. */
export async function postDecide(
  runId: string,
  body: DecideProcessRunRequest,
): Promise<ProcessRunSummary> {
  return CreateProcessRunResponseSchema.parse(
    await api<unknown>(`${runPath(runId)}/decide`, {
      method: "POST",
      body: DecideProcessRunRequestSchema.parse(body),
    }),
  );
}

/** `POST /process-runs/:id/cancel` (Huỷ lượt chạy). 200/201 ⇒ tóm tắt run. */
export async function postCancelRun(runId: string): Promise<ProcessRunSummary> {
  return CreateProcessRunResponseSchema.parse(
    await api<unknown>(`${runPath(runId)}/cancel`, { method: "POST", body: {} }),
  );
}
