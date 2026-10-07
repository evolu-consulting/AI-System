// HUB-FR-96…100 · HUB-FR-102 · route X2a (phòng chat người–người) của hub-api (plan X2a §9, mẫu `app.h3b.ts`): tách khỏi
// `app.ts`. `/directory`, `/rooms`, `/me` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
// B4: danh bạ + phòng (`/rooms`, phát `ustream:*` sau commit khi có `redis`); B5–B6 thêm route con, `/me/stream` (B7).
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { directoryRoutes } from "./modules/directory/directory.routes";
import { DirectoryService } from "./modules/directory/directory.service";
import { RoomsService } from "./modules/rooms/manage/rooms.service";
import { roomsRoutes } from "./modules/rooms/rooms.routes";

/** Gốc route X2a cần JWT (`app.ts` gắn `requireAuth` cho từng gốc). */
export const X2A_PROTECTED_PREFIXES = ["/directory", "/rooms", "/me"] as const;

/** `redis` vắng (test khung) ⇒ không phát sự kiện, DB vẫn ghi (R21). */
export type X2aDeps = { db: Db; redis?: Redis; log: Logger };

/** Mount route X2a (gọi sau khi đã gắn `requireAuth`). */
export function mountX2a<E extends Env>(app: Hono<E>, deps: X2aDeps): void {
  app.route("/directory", directoryRoutes(new DirectoryService(deps.db)));
  app.route("/rooms", roomsRoutes(new RoomsService(deps)));
}
