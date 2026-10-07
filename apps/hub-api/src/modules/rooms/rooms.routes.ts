// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · `POST/GET /rooms`, `GET/PATCH/DELETE /rooms/:id` (X2a plan §3). Thứ tự kiểm: 401
// (middleware gốc) → `:id` không uuid ⇒ 404 `ROOM_NOT_FOUND` → không phải thành viên ⇒ 404 → DM 409 → chủ 403 → body 400
// (`svc.access` TRƯỚC khi parse). Parse bằng contract chat → service → response. Không logic.

import { UuidSchema } from "@ai/contracts";
import {
  CreateRoomRequestSchema,
  RenameRoomRequestSchema,
  RoomListQuerySchema,
} from "@ai/contracts/chat";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { parseJson, parseQuery } from "../../lib/http";
import type { RoomsService } from "./manage/rooms.service";

/** `:id` không phải uuid ⇒ cùng 404 với phòng không thấy (R03), không phải `NOT_FOUND` chung. */
export function roomIdParam(c: Context, name = "id"): string {
  const id = c.req.param(name);
  if (!UuidSchema.safeParse(id).success) throw appError("ROOM_NOT_FOUND");
  return id as string;
}

export function roomsRoutes(svc: RoomsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();

  r.get("/", async (c) => c.json(await svc.list(c.var.user, parseQuery(c, RoomListQuerySchema))));

  r.post("/", async (c) => {
    const { room, created } = await svc.create(
      c.var.user,
      await parseJson(c, CreateRoomRequestSchema),
    );
    return c.json(room, created ? 201 : 200);
  });

  r.get("/:id", async (c) => c.json(await svc.get(c.var.user, roomIdParam(c))));

  r.patch("/:id", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "rename");
    const body = await parseJson(c, RenameRoomRequestSchema);
    return c.json(await svc.rename(c.var.user, id, body.name));
  });

  r.delete("/:id", async (c) => {
    await svc.remove(c.var.user, roomIdParam(c));
    return c.body(null, 204);
  });

  return r;
}
