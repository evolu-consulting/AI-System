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
import { type RoomPosterDeps, RoomRunPoster } from "./modules/rooms/agents/room-post";
import { type RoomRunDeps, RoomRunService } from "./modules/rooms/agents/room-run.service";
import { RoomsService } from "./modules/rooms/manage/rooms.service";
import { MessagesService } from "./modules/rooms/messages/messages.service";
import { roomMessagesRoutes } from "./modules/rooms/room-messages.routes";
import { roomsRoutes } from "./modules/rooms/rooms.routes";
import type { CancelService } from "./modules/runs/close/cancel.service";

/** Gốc route X2a cần JWT (`app.ts` gắn `requireAuth` cho từng gốc). */
export const X2A_PROTECTED_PREFIXES = ["/directory", "/rooms", "/me"] as const;

/** Nhịp `: ping` của `/me/stream` khi deps không truyền `pingMs` (plan §7). */
export const ME_STREAM_PING_MS_DEFAULT = 15_000;

/**
 * `redis` vắng (test khung) ⇒ không phát sự kiện, DB vẫn ghi (R21), không mount `/me/stream`. `pingMs` vắng ⇒ 15000 (test
 * truyền 500). `signal` = tắt instance ⇒ đóng mọi stream + kết nối đọc.
 */
export type X2aDeps = { db: Db; redis?: Redis; log: Logger; pingMs?: number; signal?: AbortSignal };

/** Dịch vụ X2a mà X2b nối thêm (gọi agent cần runtime dựng sau trong `app.ts`). */
export type X2aMounted = { rooms: RoomsService; messages: MessagesService };

/** Huỷ run: E15 (D15) + huỷ run phòng khi rời / bớt / xoá (R17). */
type RoomCancel = RoomRunDeps["cancel"] & Pick<CancelService, "cancelRoomRuns">;

/**
 * X2b B4 · nối đường gọi agent vào `POST /rooms/:id/messages` (sau khi có `RunService`/`CancelService`);
 * B6 · rời / bớt / xoá phòng huỷ run phòng (R17).
 */
export function mountRoomAgents(
  m: X2aMounted,
  d: Omit<RoomRunDeps, "rooms" | "cancel"> & { cancel: RoomCancel },
): void {
  m.messages.useAgents(new RoomRunService({ ...d, rooms: m.rooms }));
  m.rooms.useRunCanceller((p) => d.cancel.cancelRoomRuns(p));
}

/** X2b B5 · `RoomRunPoster` (tx2 đăng tin agent) + vòng reconcile 5 s; `onClosed` nối vào `RunService` + `CancelService`. */
export function roomPoster(d: RoomPosterDeps & { signal?: AbortSignal }): RoomRunPoster {
  const poster = new RoomRunPoster(d);
  poster.start(d.signal);
  return poster;
}

/** Mount route X2a (gọi sau khi đã gắn `requireAuth`). */
export function mountX2a<E extends Env>(app: Hono<E>, deps: X2aDeps): X2aMounted {
  app.route("/directory", directoryRoutes(new DirectoryService(deps.db)));
  const rooms = new RoomsService(deps);
  app.route("/rooms", roomsRoutes(rooms));
  const messages = new MessagesService(rooms);
  app.route("/rooms", roomMessagesRoutes(messages));
  if (!deps.redis) return { rooms, messages };
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
  return { rooms, messages };
}
