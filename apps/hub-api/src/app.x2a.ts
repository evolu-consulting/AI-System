// HUB-FR-96…100 · HUB-FR-102 · route X2a (phòng chat người–người) của hub-api (plan X2a §9, mẫu `app.h3b.ts`): tách khỏi
// `app.ts`. `/directory`, `/rooms`, `/me` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
// B4: danh bạ + phòng (`/rooms`, phát `ustream:*` sau commit khi có `redis`); B5–B6 route con (thành viên, tin, đã đọc);
// B7: `/me/stream` (cần `redis`; một `UserStreamReader` + giới hạn kết nối mỗi instance, nhịp `pingMs`).
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { directoryRoutes } from "./modules/directory/directory.routes";
import { DirectoryService } from "./modules/directory/directory.service";
import { meStreamRoutes } from "./modules/me-stream/me-stream.routes";
import { MeStreamConns } from "./modules/me-stream/me-stream.session";
import { UserStreamReader } from "./modules/me-stream/user-stream-reader";
import { RoomsService } from "./modules/rooms/manage/rooms.service";
import { MessagesService } from "./modules/rooms/messages/messages.service";
import { roomMessagesRoutes } from "./modules/rooms/room-messages.routes";
import { roomsRoutes } from "./modules/rooms/rooms.routes";

/** Gốc route X2a cần JWT (`app.ts` gắn `requireAuth` cho từng gốc). */
export const X2A_PROTECTED_PREFIXES = ["/directory", "/rooms", "/me"] as const;

/** Nhịp `: ping` của `/me/stream` khi deps không truyền `pingMs` (plan §7). */
export const ME_STREAM_PING_MS_DEFAULT = 15_000;

/**
 * `redis` vắng (test khung) ⇒ không phát sự kiện, DB vẫn ghi (R21), không mount `/me/stream`. `pingMs` vắng ⇒ 15000 (test
 * truyền 500). `signal` = tắt instance ⇒ đóng mọi stream + kết nối đọc.
 */
export type X2aDeps = { db: Db; redis?: Redis; log: Logger; pingMs?: number; signal?: AbortSignal };

/** Mount route X2a (gọi sau khi đã gắn `requireAuth`). */
export function mountX2a<E extends Env>(app: Hono<E>, deps: X2aDeps): void {
  app.route("/directory", directoryRoutes(new DirectoryService(deps.db)));
  const rooms = new RoomsService(deps);
  app.route("/rooms", roomsRoutes(rooms));
  app.route("/rooms", roomMessagesRoutes(new MessagesService(rooms)));
  if (!deps.redis) return;
  const reader = new UserStreamReader(deps.redis, deps.log, deps.signal);
  const pingMs = deps.pingMs ?? ME_STREAM_PING_MS_DEFAULT;
  app.route(
    "/me",
    meStreamRoutes({
      reader,
      conns: new MeStreamConns(),
      log: deps.log,
      pingMs,
      signal: deps.signal,
    }),
  );
}
