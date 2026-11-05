// CR-118 · lớp nối module năng lực: `GET /pack/me`, `GET /hub-admin/tenants/:id/capabilities` + N3 (đẩy `config.changed`
// qua `/me/stream`). Gọi TRƯỚC `mountProtected` (app.ts) và tự gắn JWT + tường lửa đối tác cho đúng hai đường của mình (401
// trước 404 cho cả `/hub-admin/*`). Tạo `MeStreamConns` dùng chung với `/me/stream` (X2a). Không migration (câu 23).
// Chạm gói chỉ qua `packs.mount.ts` (brand công ty) và cổng `kit/` (registry tool); agent của gói từ ảnh ConfigCache.
import type { Env, Hono } from "hono";
import { requireAuth } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import type { Redis } from "../../lib/redis";
import type { ConfigCache } from "../config/public";
import { MeStreamConns } from "../me-stream/me-stream.session";
import type { PackToolRegistry } from "../packs/kit/public";
import { externalFirewall, flowRuntimeOn } from "../packs/kit/public";
import { companyBrandModule, PACK_PREFIX } from "../packs/packs.mount";
import { loadHubExtras } from "./capabilities.repo";
import { capabilitiesAdminRoutes, shellMeRoutes } from "./capabilities.routes";
import { CapabilitiesService } from "./capabilities.service";
import { startConfigPush } from "./config-push";

export const HUB_ADMIN_PREFIX = "/hub-admin";

export type CapabilitiesMountDeps = {
  /** Vắng `db`/`config` (test khung) ⇒ không mount, không có `meConns`. */
  db?: Db;
  config?: ConfigCache;
  jwtPublicKey?: CryptoKey;
  packTools?: PackToolRegistry;
  /** Có Redis ⇒ `/me/stream` được mount ⇒ đẩy `config.changed` tới phiên của instance. */
  redis?: Redis;
  signal?: AbortSignal;
  /** Seam test của cờ flow runtime; vắng ⇒ env (mặc định bật, `HUB_FLOW_RUNTIME=off` tắt). */
  flowRuntime?: boolean | undefined;
};

export function mountCapabilities<E extends Env>(
  app: Hono<E>,
  d: CapabilitiesMountDeps,
): { svc?: CapabilitiesService; meConns?: MeStreamConns } {
  const { db, config } = d;
  if (!db || !config) return {};
  const brand = companyBrandModule(db);
  const svc = new CapabilitiesService({
    view: config,
    loadExtras: (tid) => loadHubExtras(db, tid),
    brand: (tid) => brand.brand(tid),
    tools: (p) => d.packTools?.listByPack(p) ?? [],
    onChange: (fn) => config.onChange(fn),
    flowRuntime: flowRuntimeOn(d.flowRuntime), // cùng cờ với route flow của gói (web bỏ gọi `/flow/*` khi tắt)
  });
  const auth = requireAuth(d.jwtPublicKey);
  const firewall = externalFirewall();
  for (const p of [`${PACK_PREFIX}/me`, HUB_ADMIN_PREFIX, `${HUB_ADMIN_PREFIX}/*`])
    app.use(p, auth, firewall);
  app.route(PACK_PREFIX, shellMeRoutes(svc));
  app.route(HUB_ADMIN_PREFIX, capabilitiesAdminRoutes(svc));
  const meConns = new MeStreamConns();
  if (d.redis) startConfigPush(config, meConns, d.signal);
  return { svc, meConns };
}
