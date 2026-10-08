// HUB-FR-78 · ADM-FR-37 · route H3b của hub-api (plan H3b §5.5, mẫu `app.h2b.ts`): tách khỏi `app.ts` để giữ ≤ 250 dòng.
// `/agent-grants` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 403/404).
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import { dbHubAudit, type HubAuditWriter } from "./lib/hub-audit";
import { AgentEffectiveService } from "./modules/agent-grants/agent-effective.service";
import { agentGrantRoutes } from "./modules/agent-grants/agent-grants.routes";
import { AgentGrantsService } from "./modules/agent-grants/agent-grants.service";
import { agentSettingsRoutes } from "./modules/agent-settings/agent-settings.routes";
import { AgentSettingsService } from "./modules/agent-settings/agent-settings.service";
import type { ConfigCache } from "./modules/config/config.service";

export type H3bDeps = { db: Db; config: ConfigCache; hubAudit?: HubAuditWriter };

/** Mount route H3b (gọi sau khi đã gắn `requireAuth`). `hubAudit` vắng ⇒ ghi DB thật (P12: test tiêm lỗi). */
export function mountH3b<E extends Env>(app: Hono<E>, deps: H3bDeps): void {
  const audit = deps.hubAudit ?? dbHubAudit;
  const grants = new AgentGrantsService({ db: deps.db, audit });
  const effective = new AgentEffectiveService({ db: deps.db, config: deps.config });
  app.route("/agent-grants", agentGrantRoutes(grants, effective));
  // CR-054 · agent mặc định + bật/tắt agent cho công ty (Evolu Control → Agents).
  app.route(
    "/agent-settings",
    agentSettingsRoutes(new AgentSettingsService({ db: deps.db, audit })),
  );
}
