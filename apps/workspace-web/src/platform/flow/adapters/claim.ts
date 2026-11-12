// CR-127 · U4 · E2/E3b · nhận việc nhóm: `POST /review-tasks/:id/{claim,release,reassign}` (route chung của Hub).
import type { ClaimTaskResponse, ReassignReviewTaskRequest } from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";

const enc = encodeURIComponent;
export const claimTask = (taskId: string) =>
  api<ClaimTaskResponse>(`/review-tasks/${enc(taskId)}/claim`, { method: "POST", body: {} });
export const releaseTask = (taskId: string) =>
  api<unknown>(`/review-tasks/${enc(taskId)}/release`, { method: "POST", body: {} });
export const reassignTask = (taskId: string, body: ReassignReviewTaskRequest) =>
  api<unknown>(`/review-tasks/${enc(taskId)}/reassign`, { method: "POST", body });
