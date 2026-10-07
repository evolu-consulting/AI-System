// HUB-FR-99, X2a-AC12 · GET /me/stream bằng fetch + Bearer (không token trên URL). Nơi duy nhất feature `realtime` gọi API.
// 401 → `apiResponse` refresh một lần; vẫn 401 → ném `ApiError` (driver dừng, session đã `expired`).
import { LAST_EVENT_ID_HEADER } from "@ai/contracts/chat";
import { ApiError, apiResponse } from "~/lib/http";

export async function openMeStream(
  lastEventId: string | null,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (lastEventId) headers[LAST_EVENT_ID_HEADER] = lastEventId;
  const res = await apiResponse("/me/stream", { headers, signal });
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  return res.body;
}
