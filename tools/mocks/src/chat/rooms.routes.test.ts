// HUB-FR-96 · HUB-FR-99 · HUB-FR-102 · stub X2a: hình đúng contract, `/me/stream` chỉ ping.
import { describe, expect, test } from "bun:test";
import {
  DirectoryResponseSchema,
  RoomListResponseSchema,
  SSE_PING_FRAME,
} from "@ai/contracts/chat";
import { createRoomStubRoutes, pingOnlyStream } from "./rooms.routes";

describe("stub phòng X2a", () => {
  const app = createRoomStubRoutes();

  test("GET /rooms, /directory rỗng, khớp contract", async () => {
    const rooms = await (await app.request("/rooms")).json();
    expect(RoomListResponseSchema.parse(rooms)).toEqual({
      items: [],
      next_cursor: null,
      unread_total: 0,
    });
    const dir = await (await app.request("/directory")).json();
    expect(DirectoryResponseSchema.parse(dir)).toEqual({ items: [] });
  });

  test("GET /me/stream: 200 text/event-stream, frame đầu là ping, không sự kiện", async () => {
    const res = await app.request("/me/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe(SSE_PING_FRAME);
    await reader?.cancel();
  });

  test("ping lặp theo heartbeatMs, huỷ thì dừng", async () => {
    const reader = pingOnlyStream(5).getReader();
    for (let i = 0; i < 3; i += 1) expect((await reader.read()).done).toBe(false);
    await reader.cancel();
  });
});
