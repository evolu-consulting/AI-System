// PK-FR-05 · PK-FR-09 · N1 plan §2, §9 · mount tối thiểu `/pack` (T5b): `GET /pack/<k>/me` đọc quyền từ ConfigCache (cổng
// `PackAccessView`). JWT ở gốc: `PACK_PREFIX` nằm trong `PROTECTED_PREFIXES` của `app.ts` (401 trước 404). Route nghiệp vụ
// gói + seam `deps.packs` do `modules/packs/packs.mount.ts` (T5c).
import type { Env, Hono } from "hono";
import type { ConfigCache } from "./modules/config/config.service";
import { packMeRoutes } from "./modules/packs/kit/adapters/me.route";
import type { PackAccessView } from "./modules/packs/kit/adapters/pack-guard.middleware";

export const PACK_PREFIX = "/pack";

/** Gắn `/pack/:k/me`; trả cổng quyền để module gói dùng cho `packGuard`. Gọi sau khi đã gắn `requireAuth`. */
export function mountPackKit<E extends Env>(app: Hono<E>, config: ConfigCache): PackAccessView {
  const view: PackAccessView = config;
  app.route(PACK_PREFIX, packMeRoutes(view));
  return view;
}
