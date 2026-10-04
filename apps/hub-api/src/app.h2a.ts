// HUB-FR-10 · route H2a của hub-api (plan H2a §4: `mountH2a` tách khỏi `app.ts` để giữ ≤ 250 dòng).
// `/commands` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
import type { Env, Hono } from "hono";
import { commandRoutes } from "./modules/commands/commands.routes";
import { CommandService } from "./modules/commands/commands.service";
import type { ConfigCache } from "./modules/config/config.service";

export type H2aMounted = { commands: CommandService };

/** Mount route H2a cần cache cấu hình (gọi sau khi đã gắn `requireAuth`). */
export function mountH2a<E extends Env>(app: Hono<E>, config: ConfigCache): H2aMounted {
  const commands = new CommandService(config);
  app.route("/commands", commandRoutes(commands));
  return { commands };
}
