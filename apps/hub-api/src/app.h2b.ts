// HUB-FR-92 · route H2b của hub-api (plan §4 `app.h2b.ts`): tách khỏi `app.ts` để giữ ≤ 250 dòng.
// `/agents` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
import type { Env, Hono } from "hono";
import { agentRoutes } from "./modules/agents/agents.routes";
import { AgentsService } from "./modules/agents/agents.service";
import type { ConfigCache } from "./modules/config/config.service";

/** Mount route H2b cần cache cấu hình (gọi sau khi đã gắn `requireAuth`). */
export function mountH2b<E extends Env>(app: Hono<E>, config: ConfigCache): void {
  app.route("/agents", agentRoutes(new AgentsService(config)));
}
