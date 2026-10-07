// HUB-FR-99 · ReadableStream → khung SSE thô (`createSseParser` của contracts). `onBytes` báo MỖI chunk (kể cả `: ping`,
// parser không phát khung chú thích) để driver biết kết nối còn sống. Đọc tới khi stream đóng/`signal` huỷ; lỗi đọc được ném.
import { createSseParser, type RawSseEvent } from "@ai/contracts/chat";

export async function readRawSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: RawSseEvent) => void,
  onBytes: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser(onEvent);
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal?.aborted) onAbort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal?.aborted) break;
      onBytes();
      feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
