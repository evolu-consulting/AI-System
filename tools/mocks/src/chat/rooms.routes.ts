// HUB-FR-96 · HUB-FR-99 · HUB-FR-102 · stub X2a của mock Hub (X2a tasks B3; spec Q7): đủ để chat-web chạy e2e C1 khi
// sidebar đã gọi phòng/danh bạ/luồng người dùng. Không lưu phòng, không phát sự kiện — chỉ hình đúng contract.
import {
  type DirectoryResponse,
  type RoomListResponse,
  SSE_HEARTBEAT_S,
  SSE_PING_FRAME,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { ChatVars } from "./auth";
import { sseResponse } from "./sse";

export const EMPTY_ROOMS: RoomListResponse = { items: [], next_cursor: null, unread_total: 0 };
export const EMPTY_DIRECTORY: DirectoryResponse = { items: [] };

/** `: ping` lúc mở và mỗi `heartbeatMs`; client đóng ⇒ dừng timer. */
export function pingOnlyStream(heartbeatMs = SSE_HEARTBEAT_S * 1000): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      const ping = () => {
        try {
          ctrl.enqueue(enc.encode(SSE_PING_FRAME));
        } catch {
          clearInterval(timer);
        }
      };
      ping();
      timer = setInterval(ping, heartbeatMs);
    },
    cancel() {
      clearInterval(timer);
    },
  });
}

export function createRoomStubRoutes(): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  app.get("/rooms", (c) => c.json(EMPTY_ROOMS));
  app.get("/directory", (c) => c.json(EMPTY_DIRECTORY));
  app.get("/me/stream", () => sseResponse(pingOnlyStream()));
  return app;
}
