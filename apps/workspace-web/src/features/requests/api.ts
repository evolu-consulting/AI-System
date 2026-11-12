// CR-125 · cr125-manual-start-ui · «Tạo yêu cầu»: gọi hub `GET /processes/startable`, `POST /processes/start`, `GET /processes/requests/:id`,
// tải tệp `POST /attachments`, việc chờ tôi `GET /me/review-tasks`, quyết định `POST /review-tasks/:id/decision`.

import type { EvidenceInput, ReviewTaskListResponse } from "@ai/contracts/chat";
import { type Attachment, FILENAME_HEADER } from "@ai/contracts/chat";
import type {
  MyRequestsResponse,
  StartableResponse,
  StartProcessRequest,
  StartProcessResponse,
  StartRequestView,
} from "@ai/contracts/hub-admin";
import { api } from "@ai/web-kit/http";

export const requestKeys = {
  startable: ["requests", "startable"] as const,
  one: (id: string) => ["requests", "one", id] as const,
  mine: ["requests", "mine"] as const,
  tasks: ["requests", "tasks"] as const,
  org: ["requests", "org"] as const,
};

export const fetchStartable = (signal?: AbortSignal) =>
  api<StartableResponse>("/processes/startable", { signal });
export const fetchMyRequests = (signal?: AbortSignal) =>
  api<MyRequestsResponse>("/processes/requests/mine", { signal });
export const startRequest = (body: StartProcessRequest) =>
  api<StartProcessResponse>("/processes/start", { method: "POST", body });
export const fetchRequest = (id: string, signal?: AbortSignal) =>
  api<StartRequestView>(`/processes/requests/${encodeURIComponent(id)}`, { signal });
export const fetchMyTasks = (signal?: AbortSignal) =>
  api<ReviewTaskListResponse>("/me/review-tasks", { query: { limit: 50 }, signal });
export const decideTask = (
  taskId: string,
  result: "pass" | "reject" | "fail",
  feedback?: string,
  backToStep?: number | null,
  evidence?: EvidenceInput,
) =>
  api<unknown>(`/review-tasks/${encodeURIComponent(taskId)}/decision`, {
    method: "POST",
    body: {
      result,
      ...(feedback ? { feedback } : {}),
      ...(evidence ? { evidence } : {}),
      ...(result === "fail" && typeof backToStep === "number" ? { back_to_step: backToStep } : {}),
    },
  });

/** Khoá hành động của FlowTask ⇒ kết quả của `POST /review-tasks/:id/decision` (Duyệt / Trả lại / Từ chối). */
export const RESULT_OF_ACTION: Readonly<Record<string, "pass" | "reject" | "fail">> = {
  approve: "pass",
  reject: "reject",
  return: "fail",
};

/** `POST /attachments`: thân thô + tên tệp percent-encode (cùng đường tải tệp của chat). */
export function uploadAttachment(file: File): Promise<Attachment> {
  return api<Attachment>("/attachments", {
    method: "POST",
    rawBody: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      [FILENAME_HEADER]: encodeURIComponent(file.name),
    },
  });
}
