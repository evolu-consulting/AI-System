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
import type { KhRuntime } from "./modules/kh/kh.mount";
import { KhQueryService } from "./modules/kh/kh.query.service";
import { DifyWorkflowInvoker, type WorkflowInvoker } from "./modules/mcp/adapters/workflow-invoker";
import { confirmationGate } from "./modules/mcp/confirm.service";
import { mcpRoutes } from "./modules/mcp/mcp.routes";
import { McpService } from "./modules/mcp/mcp.service";
import { packMcpTools } from "./modules/mcp/pack-tools.provider";
import type { PackToolCatalog } from "./modules/packs/kit/application/pack-tools.ports";

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
  /** K1 · `KhRuntime` của `mountH4a`; vắng ⇒ không `kh-query` (job không có `ctx.kh` thì cũng không). */
  kh?: KhRuntime;
  /** N2-FR-03 · registry tool gói (CR-087). */
  packTools?: PackToolCatalog;
};

/** P-d2 · D2-02 · MỘT `WorkflowInvoker` dùng chung cho `/mcp` và stage `tool` của quy trình (`app.ts` dựng trước mount). */
export function createWorkflowInvoker(d: Omit<McpMountDeps, "kh" | "packTools">): WorkflowInvoker {
  const credentials = new CredentialService({
    db: d.db,
    masterKey: loadMasterKey(d.secretMasterKey),
    log: d.log,
  });
  return new DifyWorkflowInvoker({
    db: d.db,
    config: d.config,
    credentials,
    dify: new DifyClient(),
    difyTimeoutMaxS: d.difyTimeoutMaxS ?? DEFAULT_DIFY_TIMEOUT_MAX_S,
    log: d.log,
    storage: d.attachments?.storage ?? null,
  });
}

const sharedInvokers = new WeakMap<ConfigCache, WorkflowInvoker>();
/** Một invoker mỗi cache cấu hình của app: module quy trình (mount trước) và `/mcp` nhận CÙNG bản. */
export function sharedWorkflowInvoker(d: Omit<McpMountDeps, "kh" | "packTools">): WorkflowInvoker {
  let inv = sharedInvokers.get(d.config);
  if (!inv) {
    inv = createWorkflowInvoker(d);
    sharedInvokers.set(d.config, inv);
  }
  return inv;
}

/** POST `/mcp` (+ 405 GET/DELETE). Gọi trước `notFound`. */
export function mountMcp<E extends Env>(app: Hono<E>, d: McpMountDeps): void {
  const difyTimeoutMaxS = d.difyTimeoutMaxS ?? DEFAULT_DIFY_TIMEOUT_MAX_S;
  const invoker = sharedWorkflowInvoker(d);
  const svc = new McpService({
    db: d.db,
    config: d.config,
    log: d.log,
    invoker,
    sideEffect: confirmationGate({ db: d.db, log: d.log }),
    kh: d.kh && new KhQueryService({ db: d.db, rt: d.kh, log: d.log }),
    ...(d.packTools ? { packTools: packMcpTools(d.packTools) } : {}),
  });
  app.route("/mcp", mcpRoutes(svc, { requestTimeoutS: difyTimeoutMaxS + MCP_IDLE_MARGIN_S }));
}
