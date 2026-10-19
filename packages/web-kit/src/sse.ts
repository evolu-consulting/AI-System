// UC-08, CHAT-AC-06 · đọc SSE bằng fetch + ReadableStream (plan-frontend D6): không EventSource vì cần POST + Bearer.
// Parser dùng chung với bộ test contract (`createSseParser`/`toChatEvent`); sự kiện hỏng bị bỏ, không làm hỏng run.
import { type ChatEvent, createSseParser, toChatEvent } from "@ai/contracts/chat";

function decodeOrSkip(onEvent: (e: ChatEvent) => void) {
  return createSseParser((raw) => {
    let event: ChatEvent;
    try {
      event = toChatEvent(raw);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn("[sse] bỏ sự kiện không hợp lệ", raw.event, err);
      return;
    }
    onEvent(event);
  });
}

/**
 * Đọc tới khi stream đóng (trả về bình thường) hoặc `signal` huỷ (trả về sớm).
 * Lỗi đọc (mất mạng giữa chừng) được ném ra để người gọi nối lại.
 */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const feed = decodeOrSkip(onEvent);
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal?.aborted) onAbort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal?.aborted) break;
      feed(decoder.decode(value, { stream: true }));
    }
    if (!signal?.aborted) feed(decoder.decode());
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
