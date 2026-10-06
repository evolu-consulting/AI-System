// HUB-FR-72 · H4a-R01 · plan P3, P4, P12 · route H4a của hub-api (mẫu `app.h3b.ts`): tách khỏi `app.ts` để giữ ≤ 250 dòng.
// `/studio/api` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc) ⇒ thứ tự 401 → 403 (`requirePlatformAdmin`) →
// 400/404, kể cả route chưa mount. Phần tĩnh `/studio` (P12) đăng ký sau route API.
import type { Env, Hono } from "hono";
import { requirePlatformAdmin } from "./lib/admin-role.middleware";
import type { Db } from "./lib/db";
import { dbHubAudit, type HubAuditWriter } from "./lib/hub-audit";
import type { Logger } from "./lib/logger";
import { agentRoutes } from "./modules/studio/agents/agents.routes";
import { AgentsService } from "./modules/studio/agents/agents.service";
import { orchestratorRoutes } from "./modules/studio/orchestrator/orchestrator.routes";
import { OrchestratorService } from "./modules/studio/orchestrator/orchestrator.service";
import { studioReadRoutes } from "./modules/studio/studio.routes";
import { StudioReadService } from "./modules/studio/studio-read.service";
import { isStudioDist, mountStudioStatic } from "./modules/studio/studio-static";

export const STUDIO_API = "/studio/api";

/** `hubAudit` vắng ⇒ ghi DB thật; test tiêm lỗi giữa transaction (P7). */
export type H4aDeps = {
  db?: Db;
  studioDist?: string;
  hubAudit?: HubAuditWriter;
  log: Pick<Logger, "warn">;
};

/**
 * Gọi sau khi đã gắn `requireAuth` cho `/studio/api/*`. Role gắn cả khi vắng `db` ⇒ 403 không phụ thuộc route đã mount.
 * Tĩnh `/studio/*` đăng ký SAU route API cùng tiền tố ⇒ route API khớp trước; route ngoài `/studio` không giao nhau.
 */
export function mountH4a<E extends Env>(app: Hono<E>, deps: H4aDeps): void {
  app.use(`${STUDIO_API}/*`, requirePlatformAdmin());
  if (deps.db) {
    const audit = deps.hubAudit ?? dbHubAudit;
    app.route(STUDIO_API, studioReadRoutes(new StudioReadService({ db: deps.db })));
    app.route(STUDIO_API, agentRoutes(new AgentsService({ db: deps.db, audit })));
    app.route(STUDIO_API, orchestratorRoutes(new OrchestratorService({ db: deps.db, audit })));
  }
  mountH4aStatic(app, deps.studioDist, deps.log);
}

/** `studioDist` có mà thiếu `index.html` ⇒ cảnh báo, không mount (plan §9). Vắng ⇒ im lặng, `/studio` 404 JSON. */
function mountH4aStatic<E extends Env>(
  app: Hono<E>,
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
