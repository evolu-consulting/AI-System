// HUB-FR-96 · HUB-FR-100 · `GET/POST /rooms/:id/messages`, `POST /rooms/:id/read` (X2a plan §3), CR-050
// `POST /rooms/:id/flows/:flow_id/read` (`:flow_id` không uuid ⇒ 404 như thread lạ). Thứ tự kiểm: 401
// (middleware gốc) → `:id` không uuid ⇒ 404 → không phải thành viên ⇒ 404 (`svc.access` TRƯỚC khi parse) → body/query 400.
// Parse bằng contract chat → service → response. Không logic.

import { UuidSchema } from "@ai/contracts";
import {
  FLOW_ID_HEADER,
  MarkRoomFlowReadRequestSchema,
  MarkRoomReadRequestSchema,
  RoomMessageListQuerySchema,
  RUN_ID_HEADER,
  SendRoomMessageRequestSchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
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

  r.post("/:id/flows/:flow_id/read", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "read");
    const flowId = c.req.param("flow_id");
    if (!UuidSchema.safeParse(flowId).success) throw appError("NOT_FOUND");
    const body = await parseJson(c, MarkRoomFlowReadRequestSchema);
    return c.json(await svc.markFlowRead(c.var.user, id, flowId, body.seq));
  });

  return r;
}
