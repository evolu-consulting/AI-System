// HUB-FR-50, HUB-FR-24, WRK-FR-13 · nối MCP H2a vào app (plan §4, §6): route `/mcp` (không JWT) + `mcp` của payload job
// agent. Tách khỏi `app.ts` để giữ ≤ 250 dòng.
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { AttachmentStorage } from "./modules/attachments/storage";
import type { CatalogSnapshot } from "./modules/config/catalog.rules";
import type { ConfigCache } from "./modules/config/config.service";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { DifyClient } from "./modules/dify/dify.client";
import { confirmationGate } from "./modules/mcp/confirm.service";
import { mcpRoutes } from "./modules/mcp/mcp.routes";
import { McpService } from "./modules/mcp/mcp.service";

/** = `HUB_DIFY_TIMEOUT_MAX_S` mặc định (plan §8). */
export const DEFAULT_DIFY_TIMEOUT_MAX_S = 300;
/** Biên cho idle timeout của request `/mcp` (Bun) trên hạn tool. */
const MCP_IDLE_MARGIN_S = 30;

/** `HUB_PUBLIC_INTERNAL_URL` → URL `/mcp` đầy đủ (plan-rules `mcpConfigFor`: người gọi nối). */
export function mcpUrlOf(publicInternalUrl: string): string {
  return `${publicInternalUrl.replace(/\/+$/, "")}/mcp`;
}

/** Cấu hình MCP cho `JobAgentRunner` (payload `agent.cli.mcp`); vắng URL công khai → không MCP. */
export function runnerMcp(
  publicInternalUrl: string | undefined,
  config: ConfigCache,
): { url: string; catalog: () => Promise<CatalogSnapshot> } | undefined {
  if (!publicInternalUrl) return undefined;
  return { url: mcpUrlOf(publicInternalUrl), catalog: () => config.catalog() };
}

export type McpMountDeps = {
  db: Db;
  config: ConfigCache;
  log: Logger;
  /** = `SECRET_MASTER_KEY` (đã kiểm ở `server.ts`); vắng → mọi tool `NOT_CONFIGURED`. */
  secretMasterKey?: string;
  difyTimeoutMaxS?: number;
  /** H2c B8 · kho file (`AppDeps.attachments`) để upload file của `tools/call` lên Dify. */
  attachments?: { storage: Pick<AttachmentStorage, "blob"> };
};

/** POST `/mcp` (+ 405 GET/DELETE). Gọi trước `notFound`. */
export function mountMcp<E extends Env>(app: Hono<E>, d: McpMountDeps): void {
  const difyTimeoutMaxS = d.difyTimeoutMaxS ?? DEFAULT_DIFY_TIMEOUT_MAX_S;
  const credentials = new CredentialService({
    db: d.db,
    masterKey: loadMasterKey(d.secretMasterKey),
    log: d.log,
  });
  const svc = new McpService({
    db: d.db,
    config: d.config,
    credentials,
    dify: new DifyClient(),
    difyTimeoutMaxS,
    log: d.log,
    sideEffect: confirmationGate({ db: d.db, log: d.log }),
    storage: d.attachments?.storage ?? null,
  });
  app.route("/mcp", mcpRoutes(svc, { requestTimeoutS: difyTimeoutMaxS + MCP_IDLE_MARGIN_S }));
}
