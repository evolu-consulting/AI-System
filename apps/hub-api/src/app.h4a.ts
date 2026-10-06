// HUB-FR-72 · H4a-R01 · plan P3, P4, P12 · route H4a của hub-api (mẫu `app.h3b.ts`): tách khỏi `app.ts` để giữ ≤ 250 dòng.
// `/studio/api` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc) ⇒ thứ tự 401 → 403 (`requirePlatformAdmin`) →
// 400/404, kể cả route chưa mount. Phần tĩnh `/studio` (P12) đăng ký sau route API.
import type { Hono } from "hono";
import type { AppVars } from "./app";
import { requirePlatformAdmin } from "./lib/admin-role.middleware";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import { studioReadRoutes } from "./modules/studio/studio.routes";
import { StudioReadService } from "./modules/studio/studio-read.service";
import { isStudioDist, mountStudioStatic } from "./modules/studio/studio-static";

export const STUDIO_API = "/studio/api";

export type H4aDeps = { db?: Db; studioDist?: string; log: Pick<Logger, "warn"> };

/**
 * Gọi sau khi đã gắn `requireAuth` cho `/studio/api/*`. Role gắn cả khi vắng `db` ⇒ 403 không phụ thuộc route đã mount.
 * Tĩnh `/studio/*` đăng ký SAU route API cùng tiền tố ⇒ route API khớp trước; route ngoài `/studio` không giao nhau.
 */
export function mountH4a(app: Hono<AppVars>, deps: H4aDeps): void {
  app.use(`${STUDIO_API}/*`, requirePlatformAdmin());
  if (deps.db) app.route(STUDIO_API, studioReadRoutes(new StudioReadService({ db: deps.db })));
  mountH4aStatic(app, deps.studioDist, deps.log);
}

/** `studioDist` có mà thiếu `index.html` ⇒ cảnh báo, không mount (plan §9). Vắng ⇒ im lặng, `/studio` 404 JSON. */
function mountH4aStatic(
  app: Hono<AppVars>,
  studioDist: string | undefined,
  log: Pick<Logger, "warn">,
): void {
  if (studioDist === undefined) return;
  if (!isStudioDist(studioDist)) {
    log.warn("studio-dist-missing", { dir: studioDist });
    return;
  }
  mountStudioStatic(app, studioDist);
}
