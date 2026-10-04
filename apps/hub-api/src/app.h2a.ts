// HUB-FR-10, HUB-FR-11 · route H2a của hub-api (plan H2a §4: `mountH2a` tách khỏi `app.ts` để giữ ≤ 250 dòng).
// `/commands` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
import type { Env, Hono } from "hono";
import { commandRoutes } from "./modules/commands/commands.routes";
import { CommandService, type PreparedCommand } from "./modules/commands/commands.service";
import type { ConfigCache } from "./modules/config/config.service";
import type { PrepareCommand } from "./modules/runs/runs.routes";
import type { RunDriver } from "./modules/runs/runs.service";

/** Chỗ cắm driver lệnh (B5 `command-driver`: Dify sync/async). */
export type CommandDriverFor = (p: PreparedCommand) => RunDriver;

/**
 * Tới khi có `command-driver` (B5): run lệnh đã tạo đúng (`kind=command`) rồi kết thúc `INTERNAL_ERROR`, không gọi Dify.
 * Không để run treo tới sweeper.
 */
export const pendingCommandDriver: CommandDriverFor = () => ({
  start: (ctx) => void ctx.writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" }),
});

export type H2aMounted = { commands: CommandService; prepareCommand: PrepareCommand };

/** Mount route H2a cần cache cấu hình (gọi sau khi đã gắn `requireAuth`). */
export function mountH2a<E extends Env>(
  app: Hono<E>,
  config: ConfigCache,
  driverFor: CommandDriverFor = pendingCommandDriver,
): H2aMounted {
  const commands = new CommandService(config);
  app.route("/commands", commandRoutes(commands));
  const prepareCommand: PrepareCommand = async (u, req) => {
    const p = await commands.prepare(u, req);
    return {
      kind: "command",
      commandId: p.command.id,
      featureId: p.featureId,
      driver: driverFor(p),
    };
  };
  return { commands, prepareCommand };
}
