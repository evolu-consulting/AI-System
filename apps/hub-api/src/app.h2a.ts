// HUB-FR-10, HUB-FR-11 · route H2a của hub-api (plan H2a §4: `mountH2a` tách khỏi `app.ts` để giữ ≤ 250 dòng).
// `/commands` nằm trong `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc, 401 trước 404).
import type { Env, Hono } from "hono";
import { DEFAULT_DIFY_TIMEOUT_MAX_S } from "./app.mcp";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import { asyncCommandDriver } from "./modules/commands/command-async-driver";
import { type CommandDriverDeps, commandDriver } from "./modules/commands/command-driver";
import { commandRoutes } from "./modules/commands/commands.routes";
import { CommandService, type PreparedCommand } from "./modules/commands/commands.service";
import type { ConfigCache } from "./modules/config/config.service";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { DifyClient } from "./modules/dify/dify.client";
import { testRunRoutes } from "./modules/internal/test-run.routes";
import { TestRunService } from "./modules/internal/test-run.service";
import type { WorkflowJobRunner } from "./modules/runner/workflow-job-runner";
import type { PrepareCommand } from "./modules/runs/runs.routes";
import type { RunDriver } from "./modules/runs/runs.service";

/** Chỗ cắm driver lệnh (B5 `command-driver`: Dify sync/async). */
export type CommandDriverFor = (p: PreparedCommand) => RunDriver;

/**
 * Lệnh không có driver (async khi app dựng không có Redis — test khung): run lệnh đã tạo đúng (`kind=command`) rồi kết
 * thúc `INTERNAL_ERROR`, không gọi Dify. Không để run treo tới sweeper.
 */
export const pendingCommandDriver: CommandDriverFor = () => ({
  start: (ctx) => void ctx.writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" }),
});

export type CommandDriverMountDeps = {
  db: Db;
  log: Logger;
  /** = `SECRET_MASTER_KEY` (đã kiểm ở `server.ts`); vắng → mọi lệnh `NOT_CONFIGURED`. */
  secretMasterKey?: string;
  /** B6 · runner job `workflow.async` (`app.async.ts`); vắng → lệnh async `pendingCommandDriver`. */
  jobs?: Pick<WorkflowJobRunner, "run">;
};

/** B5 · lệnh `sync` → `command-driver` (Dify streaming); B6 · `async` → `command-async-driver` (job `workflow.async`). */
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
  const jobs = m.jobs;
  return (p) => {
    if (p.command.mode === "sync") return commandDriver(d, p);
    return jobs ? asyncCommandDriver({ db: m.db, jobs, log: m.log }, p) : pendingCommandDriver(p);
  };
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

export type TestRunMountDeps = CommandDriverMountDeps & {
  config: ConfigCache;
  /** = `HUB_INTERNAL_TOKEN`; vắng → 503 `UNAVAILABLE`. */
  internalToken?: string;
  difyTimeoutMaxS?: number;
};

/** B10 · POST `/internal/test-run` (token dịch vụ, không JWT — H2a-R24). Gọi trước `notFound`. */
export function mountTestRun<E extends Env>(app: Hono<E>, m: TestRunMountDeps): void {
  const svc = new TestRunService({
    config: m.config,
    credentials: new CredentialService({
      db: m.db,
      masterKey: loadMasterKey(m.secretMasterKey),
      log: m.log,
    }),
    dify: new DifyClient(),
    log: m.log,
    timeoutMaxS: m.difyTimeoutMaxS ?? DEFAULT_DIFY_TIMEOUT_MAX_S,
  });
  app.route("/internal", testRunRoutes(svc, m.internalToken));
}
