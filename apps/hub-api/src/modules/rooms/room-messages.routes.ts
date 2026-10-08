// HUB-FR-96 · HUB-FR-100 · `GET/POST /rooms/:id/messages`, `POST /rooms/:id/read` (X2a plan §3). Thứ tự kiểm: 401
// (middleware gốc) → `:id` không uuid ⇒ 404 → không phải thành viên ⇒ 404 (`svc.access` TRƯỚC khi parse) → body/query 400.
// Parse bằng contract chat → service → response. Không logic.
import {
  FLOW_ID_HEADER,
  MarkRoomReadRequestSchema,
  RoomMessageListQuerySchema,
  RUN_ID_HEADER,
  SendRoomMessageRequestSchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseJson, parseQuery } from "../../lib/http";
import type { MessagesService } from "./messages/messages.service";
import { roomIdParam } from "./rooms.routes";

export function roomMessagesRoutes(svc: MessagesService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();

  r.get("/:id/messages", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "view");
    return c.json(await svc.page(c.var.user, id, parseQuery(c, RoomMessageListQuerySchema)));
  });

  r.post("/:id/messages", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "send");
    const body = await parseJson(c, SendRoomMessageRequestSchema);
    const { message, created, run } = await svc.send(c.var.user, id, body);
    // X2b D11 · body giữ `RoomMessage`; run trả qua header như E12.
    if (run) {
      c.header(RUN_ID_HEADER, run.runId);
      c.header(FLOW_ID_HEADER, run.flowId);
    }
    return c.json(message, created ? 201 : 200);
  });

  r.post("/:id/read", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "read");
    const body = await parseJson(c, MarkRoomReadRequestSchema);
    return c.json(await svc.markRead(c.var.user, id, body.seq));
  });

  return r;
}
