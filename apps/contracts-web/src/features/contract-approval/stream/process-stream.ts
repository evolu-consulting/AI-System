// CR-107 · eng-card-ui: nghe `/me/stream` của hub (cùng token web-kit như mọi API của app) để thẻ duyệt tải lại khi run đổi,
// thay cho poll. Nối lại giãn dần 1→30 s chỉ khi đứt (không phải chờ trạng thái); 401 sau refresh ⇒ dừng (phiên hết hạn).
import {
  createSseParser,
  type MeStreamProcessEvent,
  parseMeStreamProcessEvent,
} from "@ai/contracts/chat";
import { ApiError, apiResponse } from "@ai/web-kit/http";

const RECONNECT_FIRST_MS = 1000;
const RECONNECT_CAP_MS = 30_000;
export const reconnectDelay = (n: number): number =>
  Math.min(RECONNECT_FIRST_MS * 2 ** n, RECONNECT_CAP_MS);

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Đọc tới khi stream đóng / huỷ; chỉ chuyển sự kiện quy trình hợp lệ, bỏ khung khác (ping, phòng chat…). */
async function readOnce(
  signal: AbortSignal,
  onOpen: () => void,
  onEvent: (e: MeStreamProcessEvent) => void,
): Promise<void> {
  const res = await apiResponse("/me/stream", { headers: { Accept: "text/event-stream" }, signal });
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  onOpen();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser((raw) => {
    const e = parseMeStreamProcessEvent(raw.event, raw.data);
    if (e) onEvent(e);
  });
  signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
  for (;;) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) return;
    feed(decoder.decode(value, { stream: true }));
  }
}

/**
 * Vòng nghe tới khi `signal` huỷ. `onReconnected` gọi khi kết nối LẠI sau đứt (có thể lỡ sự kiện ⇒ tải lại một lần).
 * Không gửi `Last-Event-ID` (chỉ cần "có gì đổi" ⇒ tải lại thẻ).
 */
export async function listenProcessEvents(
  signal: AbortSignal,
  onEvent: (e: MeStreamProcessEvent) => void,
  onReconnected: () => void,
): Promise<void> {
  let failures = 0;
  let wasOpen = false;
  while (!signal.aborted) {
    try {
      await readOnce(
        signal,
        () => {
          if (wasOpen) onReconnected();
          wasOpen = true;
          failures = 0;
        },
        onEvent,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
    }
    if (signal.aborted) return;
    await sleep(reconnectDelay(failures++), signal);
  }
}
