// HUB-FR-112 · U1 · `/me/stream` của mock khi có quy trình: ping + sự kiện quy trình (`process.*`, `review_task.*`) và
// `room.message` (tin `process`) theo người nhận. Thay stub ping-only của X2a (đăng ký trước stub).
import { SSE_HEARTBEAT_S, SSE_PING_FRAME } from "@ai/contracts/chat";
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { sseResponse } from "../sse";
import { me } from "./http";

type Listener = (frame: string) => void;

export class ProcessBus {
  private listeners = new Map<string, Set<Listener>>();
  private n = 0;

  emit(userIds: readonly string[], event: string, data: unknown): void {
    for (const u of new Set(userIds)) {
      this.n += 1;
      const frame = `event: ${event}\nid: ${this.n}-0\ndata: ${JSON.stringify(data)}\n\n`;
      for (const l of this.listeners.get(u) ?? []) l(frame);
    }
  }
  subscribe(userId: string, l: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set();
    set.add(l);
    this.listeners.set(userId, set);
    return () => set.delete(l);
  }
}

function userStream(bus: ProcessBus, userId: string, heartbeatMs: number) {
  const enc = new TextEncoder();
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      const write = (f: string) => {
        try {
          ctrl.enqueue(enc.encode(f));
        } catch {
          stop();
        }
      };
      write(SSE_PING_FRAME);
      const timer = setInterval(() => write(SSE_PING_FRAME), heartbeatMs);
      const off = bus.subscribe(userId, write);
      stop = () => {
        clearInterval(timer);
        off();
      };
    },
    cancel() {
      stop();
    },
  });
}

export function createProcessStreamRoutes(bus: ProcessBus, heartbeatMs = SSE_HEARTBEAT_S * 1000) {
  const app = new Hono<ChatVars>();
  app.get("/me/stream", (c) => sseResponse(userStream(bus, me(c), heartbeatMs)));
  return app;
}
