// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · `POST/GET /rooms`, `GET/PATCH/DELETE /rooms/:id`, thành viên `/rooms/:id/{members,
// leave,transfer,hide}` (X2a plan §3). Thứ tự kiểm: 401
// (middleware gốc) → `:id` không uuid ⇒ 404 `ROOM_NOT_FOUND` → không phải thành viên ⇒ 404 → DM 409 → chủ 403 → body 400
// (`svc.access` TRƯỚC khi parse). Parse bằng contract chat → service → response. Không logic.

import { UuidSchema } from "@ai/contracts";
import {
  AddRoomMembersRequestSchema,
  CreateRoomRequestSchema,
  RenameRoomRequestSchema,
  RoomListQuerySchema,
  TransferRoomRequestSchema,
} from "@ai/contracts/chat";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { parseJson, parseQuery } from "../../lib/http";
import { MembersService } from "./manage/members.service";
import type { RoomsService } from "./manage/rooms.service";

/** `:id` không phải uuid ⇒ cùng 404 với phòng không thấy (R03), không phải `NOT_FOUND` chung. */
export function roomIdParam(c: Context, name = "id"): string {
  const id = c.req.param(name);
  if (!UuidSchema.safeParse(id).success) throw appError("ROOM_NOT_FOUND");
  return id as string;
}

export function roomsRoutes(
  svc: RoomsService,
  members: MembersService = new MembersService(svc),
): Hono<AuthVars> {
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

  memberRoutes(r, members);
  return r;
}

/** `/:id/members`, `/:id/members/:user_id`, `/:id/leave`, `/:id/transfer`, `/:id/hide` (B5). */
function memberRoutes(r: Hono<AuthVars>, svc: MembersService): void {
  r.post("/:id/members", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "add");
    const body = await parseJson(c, AddRoomMembersRequestSchema);
    return c.json(await svc.add(c.var.user, id, body.user_ids));
  });

  r.delete("/:id/members/:user_id", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "remove");
    await svc.removeMember(c.var.user, id, c.req.param("user_id"));
    return c.body(null, 204);
  });

  r.post("/:id/leave", async (c) => {
    await svc.leave(c.var.user, roomIdParam(c));
    return c.body(null, 204);
  });

  r.post("/:id/transfer", async (c) => {
    const id = roomIdParam(c);
    await svc.access(c.var.user, id, "transfer");
    const body = await parseJson(c, TransferRoomRequestSchema);
    return c.json(await svc.transfer(c.var.user, id, body.user_id));
  });

  r.post("/:id/hide", async (c) => {
    await svc.hide(c.var.user, roomIdParam(c));
    return c.body(null, 204);
  });
}
