// HUB-FR-10, HUB-FR-11 · route H2a của hub-api (plan H2a §4: `mountH2a` tách khỏi `app.ts` để giữ ≤ 250 dòng).
// `/commands` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import { type CommandDriverDeps, commandDriver } from "./modules/commands/command-driver";
import { commandRoutes } from "./modules/commands/commands.routes";
import { CommandService, type PreparedCommand } from "./modules/commands/commands.service";
import type { ConfigCache } from "./modules/config/config.service";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { DifyClient } from "./modules/dify/dify.client";
import type { PrepareCommand } from "./modules/runs/runs.routes";
import type { RunDriver } from "./modules/runs/runs.service";

/** Chỗ cắm driver lệnh (B5 `command-driver`: Dify sync/async). */
export type CommandDriverFor = (p: PreparedCommand) => RunDriver;

/**
 * Lệnh chưa có driver (async tới B6): run lệnh đã tạo đúng (`kind=command`) rồi kết thúc `INTERNAL_ERROR`, không gọi
 * Dify. Không để run treo tới sweeper.
 */
export const pendingCommandDriver: CommandDriverFor = () => ({
  start: (ctx) => void ctx.writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" }),
});

export type CommandDriverMountDeps = {
  db: Db;
  log: Logger;
  /** = `SECRET_MASTER_KEY` (đã kiểm ở `server.ts`); vắng → mọi lệnh `NOT_CONFIGURED`. */
  secretMasterKey?: string;
};

/** B5 · lệnh `sync` → `command-driver` (Dify streaming); `async` → `pendingCommandDriver` tới B6. */
export function commandDriverFor(m: CommandDriverMountDeps): CommandDriverFor {
  const d: CommandDriverDeps = {
    db: m.db,
    credentials: new CredentialService({
      db: m.db,
      masterKey: loadMasterKey(m.secretMasterKey),
      log: m.log,
    }),
    dify: new DifyClient(),
    log: m.log,
  };
  return (p) => (p.command.mode === "sync" ? commandDriver(d, p) : pendingCommandDriver(p));
}

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
