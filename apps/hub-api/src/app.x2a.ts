// HUB-FR-96…100 · HUB-FR-102 · route X2a (phòng chat người–người) của hub-api (plan X2a §9, mẫu `app.h3b.ts`): tách khỏi
// `app.ts`. `/directory`, `/rooms`, `/me` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
// B3: chỉ danh bạ; phòng (B4–B6) và `/me/stream` (B7) gắn thêm ở đây.
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import { directoryRoutes } from "./modules/directory/directory.routes";
import { DirectoryService } from "./modules/directory/directory.service";

/** Gốc route X2a cần JWT (`app.ts` gắn `requireAuth` cho từng gốc). */
export const X2A_PROTECTED_PREFIXES = ["/directory", "/rooms", "/me"] as const;

export type X2aDeps = { db: Db };

/** Mount route X2a (gọi sau khi đã gắn `requireAuth`). */
export function mountX2a<E extends Env>(app: Hono<E>, deps: X2aDeps): void {
  app.route("/directory", directoryRoutes(new DirectoryService(deps.db)));
}
