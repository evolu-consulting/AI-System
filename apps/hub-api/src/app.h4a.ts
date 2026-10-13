// HUB-FR-72 · H4a-R01 · plan P3, P4, P12 · route H4a của hub-api (mẫu `app.h3b.ts`): tách khỏi `app.ts` để giữ ≤ 250 dòng.
// `/studio/api` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc) ⇒ thứ tự 401 → 403 (`requirePlatformAdmin`) →
// 400/404, kể cả route chưa mount. Phần tĩnh `/studio` (P12) đăng ký sau route API.
import type { Env, Hono } from "hono";
import type { KhConfig } from "./config/env";
import { requirePlatformAdmin } from "./lib/admin-role.middleware";
import type { Db } from "./lib/db";
import { dbHubAudit, type HubAuditWriter } from "./lib/hub-audit";
import type { Logger } from "./lib/logger";
import { type KhRuntime, khRuntime, mountKh } from "./modules/kh/kh.mount";
import type { SecretKey } from "./modules/secrets/secrets.crypto";
import { mountSecrets } from "./modules/secrets/secrets.mount";
import { HubSecretReader } from "./modules/secrets/secrets.use";
import { agentRoutes } from "./modules/studio/agents/agents.routes";
import { AgentsService } from "./modules/studio/agents/agents.service";
import { ProviderCheckService } from "./modules/studio/models/provider-check";
import { providerRoutes } from "./modules/studio/models/providers.routes";
import { ProvidersService } from "./modules/studio/models/providers.service";
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
  /** H4b-1 D11 · khoá secrets Hub; vắng ⇒ POST/PUT secret có `value` 409 `NOT_CONFIGURED`. */
  hubSecretsKey?: SecretKey | null;
  /** K1 G1 · origin KH được phép + hạn mỗi lời gọi; vắng ⇒ `KH_CONFIG_NONE`. */
  kh?: KhConfig;
  appEnv?: "development" | "test" | "production";
  /** H4b-2 plan §4 · "Kiểm tra key" gọi hãng; vắng ⇒ `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** H4b-2 plan §4 · chờ probe subscription; vắng ⇒ `Bun.sleep`. */
  sleep?: (ms: number) => Promise<void>;
  log: Pick<Logger, "warn" | "info">;
};

/**
 * Gọi sau khi đã gắn `requireAuth` cho `/studio/api/*`. Role gắn cả khi vắng `db` ⇒ 403 không phụ thuộc route đã mount.
 * Tĩnh `/studio/*` đăng ký SAU route API cùng tiền tố ⇒ route API khớp trước; route ngoài `/studio` không giao nhau.
 */
export function mountH4a<E extends Env>(app: Hono<E>, deps: H4aDeps): KhRuntime | undefined {
  app.use(`${STUDIO_API}/*`, requirePlatformAdmin());
  let kh: KhRuntime | undefined;
  if (deps.db) {
    const audit = deps.hubAudit ?? dbHubAudit;
    app.route(STUDIO_API, studioReadRoutes(new StudioReadService({ db: deps.db })));
    app.route(STUDIO_API, agentRoutes(new AgentsService({ db: deps.db, audit })));
    app.route(STUDIO_API, orchestratorRoutes(new OrchestratorService({ db: deps.db, audit })));
    // H4b-2 · Models: provider (B3). Fail-closed: vắng `appEnv` ⇒ không dev (http loopback bị chặn).
    const env = { dev: deps.appEnv === "development" || deps.appEnv === "test" };
    const key = deps.hubSecretsKey ?? null;
    const checker = new ProviderCheckService({
      db: deps.db,
      audit,
      reader: new HubSecretReader({ db: deps.db, key, log: deps.log }),
      fetch: deps.fetch ?? globalThis.fetch,
      sleep: deps.sleep ?? ((ms) => Bun.sleep(ms)),
      log: deps.log,
    });
    app.route(
      STUDIO_API,
      providerRoutes(new ProvidersService({ db: deps.db, audit, env }), checker),
    );
    // H4b-1 · Studio `/secrets*` + route tenant `/admin/source-credentials*` (cùng service).
    mountSecrets(app, { db: deps.db, audit, key, studioBase: STUDIO_API });
    // K1 · `/kh/connections*`; `KhRuntime` (client + cache project) một instance cho cả process (T5e dùng).
    kh = khRuntime({ ...deps, db: deps.db, key });
    mountKh(app, { db: deps.db, audit, studioBase: STUDIO_API, rt: kh });
  }
  mountH4aStatic(app, deps.studioDist, deps.log);
  return kh;
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
