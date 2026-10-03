// UC-02, UC-04, UC-08 · gọi E12–E15 của Hub (nơi duy nhất feature `run` gọi API). Lỗi trước stream là JSON → `ApiError`.
import {
  FLOW_ID_HEADER,
  LAST_EVENT_ID_HEADER,
  MESSAGE_ID_HEADER,
  RUN_ID_HEADER,
  type Run,
  type SendMessageRequest,
} from "@ai/contracts/chat";
import { ApiError, api, apiResponse } from "~/lib/http";

const SSE_ACCEPT = { Accept: "text/event-stream" };

export type SendAccepted = {
  runId: string;
  flowId: string;
  messageId: string;
  body: ReadableStream<Uint8Array>;
};

function streamBody(res: Response): ReadableStream<Uint8Array> {
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  return res.body;
}

function header(res: Response, name: string): string {
  const v = res.headers.get(name);
  if (!v) throw new ApiError(res.status, "HTTP_ERROR", `Missing ${name}`);
  return v;
}

/** E12: gửi tin; không `flow_id` → flow mới. 200 = stream SSE + header id. 409 `FLOW_BUSY` ném `ApiError`. */
export async function sendMessage(
  convId: string,
  req: SendMessageRequest,
  signal?: AbortSignal,
): Promise<SendAccepted> {
  const res = await apiResponse(`/conversations/${encodeURIComponent(convId)}/messages`, {
    method: "POST",
    body: req,
    headers: SSE_ACCEPT,
    signal,
  });
  return {
    runId: header(res, RUN_ID_HEADER),
    flowId: header(res, FLOW_ID_HEADER),
    messageId: header(res, MESSAGE_ID_HEADER),
    body: streamBody(res),
  };
}

/** E13: phát lại sự kiện `id > lastEventId` rồi tiếp tục. Chưa nhận sự kiện nào (0) → không gửi header. 410 `EVENTS_EXPIRED`. */
export async function openEvents(
  runId: string,
  lastEventId: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = { ...SSE_ACCEPT };
  if (lastEventId > 0) headers[LAST_EVENT_ID_HEADER] = String(lastEventId);
  const res = await apiResponse(`/runs/${encodeURIComponent(runId)}/events`, { headers, signal });
  return streamBody(res);
}

/** E14: ảnh chụp run. */
export function getRun(runId: string): Promise<Run> {
  return api<Run>(`/runs/${encodeURIComponent(runId)}`);
}

/** E15: yêu cầu dừng; idempotent. Kết quả thật đến qua stream (`run.failed CANCELLED`). */
export function cancelRun(runId: string): Promise<Run> {
  return api<Run>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}
