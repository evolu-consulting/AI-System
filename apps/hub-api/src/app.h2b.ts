// HUB-FR-91 · HUB-FR-92 · route H2b của hub-api (plan §4 `app.h2b.ts`): tách khỏi `app.ts` để giữ ≤ 250 dòng.
// `/agents` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
import type { Env, Hono } from "hono";
import { agentRoutes } from "./modules/agents/agents.routes";
import { AgentsService } from "./modules/agents/agents.service";
import type { ConfigCache } from "./modules/config/config.service";
import { MentionService } from "./modules/mention/mention.service";
import type { PrepareMention } from "./modules/runs/runs.routes";

export type H2bMounted = { prepareMention: PrepareMention };

/** Mount route H2b cần cache cấu hình (gọi sau khi đã gắn `requireAuth`); trả router `@` cho E12. */
export function mountH2b<E extends Env>(app: Hono<E>, config: ConfigCache): H2bMounted {
  app.route("/agents", agentRoutes(new AgentsService(config)));
  const mention = new MentionService(config);
  return { prepareMention: (u, routed) => mention.prepare(u, routed) };
}
