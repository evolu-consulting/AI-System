// CHAT-AC-06, CHAT-AC-28 · stream SSE của một run (plan C1 §2.5, §3.1): phát lại sự kiện `id > fromId`, rồi nghe tiếp
// tới sự kiện kết thúc; `: ping` lúc mở và mỗi `SSE_HEARTBEAT_S`. Client đóng → gỡ listener + timer, run vẫn chạy (HUB-FR-42).
import {
  type ChatEvent,
  encodeSseEvent,
  SSE_CONTENT_TYPE,
  SSE_HEARTBEAT_S,
  SSE_PING_FRAME,
  TERMINAL_EVENTS,
} from "@ai/contracts/chat";
import type { RunEngine, RunRec } from "./runs";

export type StreamOptions = { heartbeatMs?: number };

const isTerminal = (e: ChatEvent) => (TERMINAL_EVENTS as readonly string[]).includes(e.event);

type Pipe = { done: boolean; stop: () => void };

/** Nối `ctrl` vào run: phát lại `id > fromId`, rồi nghe tiếp + ping; đóng sau sự kiện kết thúc. */
function attach(
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  p: Pipe,
  src: { engine: RunEngine; r: RunRec; fromId: number; heartbeatMs: number },
): void {
  const enc = new TextEncoder();
  const close = () => {
    if (p.done) return;
    p.done = true;
    p.stop();
    ctrl.close();
  };
  const write = (s: string) => {
    if (p.done) return;
    try {
      ctrl.enqueue(enc.encode(s));
    } catch {
      p.done = true;
      p.stop();
    }
  };
  const onEvent = (e: ChatEvent) => {
    if (e.id <= src.fromId) return;
    write(encodeSseEvent(e));
    if (isTerminal(e)) close();
  };
  // Khung chú thích đầu tiên đẩy header đi ngay (fetch chỉ trả Response khi có byte body) — `flow-cold`.
  write(SSE_PING_FRAME);
  for (const e of src.r.events) onEvent(e);
  if (p.done || src.r.status !== "running") {
    close();
    return;
  }
  const unsubscribe = src.engine.subscribe(src.r, onEvent);
  const ping = setInterval(() => write(SSE_PING_FRAME), src.heartbeatMs);
  p.stop = () => {
    unsubscribe();
    clearInterval(ping);
  };
}

/** Body SSE của run từ `fromId` (0 = từ đầu). Run đã kết thúc → phát phần còn lại rồi đóng. */
export function runStream(
  engine: RunEngine,
  r: RunRec,
  fromId: number,
  opts: StreamOptions = {},
): ReadableStream<Uint8Array> {
  const p: Pipe = { done: false, stop: () => {} };
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_S * 1000;
  return new ReadableStream<Uint8Array>({
    start: (ctrl) => attach(ctrl, p, { engine, r, fromId, heartbeatMs }),
    cancel: () => {
      p.done = true;
      p.stop();
    },
  });
}

/** Response SSE: header contract + chống đệm proxy (plan §2.4 E12, §6 R3). */
export function sseResponse(body: ReadableStream<Uint8Array>, extra: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": SSE_CONTENT_TYPE,
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      ...extra,
    },
  });
}
