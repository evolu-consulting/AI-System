// HUB-NFR-04 · H1-R26 · dựng app Hono của hub-api (plan H1 §4). Factory thuần: không đọc env, để test in-process.
// Middleware: request_id → logger (child có request_id) → CORS. Lỗi theo `CHAT_API_ERRORS` (contract chat).

import { hostname } from "node:os";
import {
  FILENAME_HEADER,
  FLOW_ID_HEADER,
  HealthResponseSchema,
  MESSAGE_ID_HEADER,
  RETRY_AFTER_HEADER,
  RUN_ID_HEADER,
} from "@ai/contracts/chat";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { mountDifyCredential, workflowJobs } from "./app.async";
import { commandDriverFor, mountH2a, mountTestRun } from "./app.h2a";
import { mountH2b } from "./app.h2b";
import { mountH2c } from "./app.h2c";
import { mountH3b } from "./app.h3b";
import { mountH4a } from "./app.h4a";
import { mountMcp } from "./app.mcp";
import { runDrivers, startRunLoops } from "./app.runner";
import { mountX2a, X2A_PROTECTED_PREFIXES } from "./app.x2a";
import { type AuthUser, requireAuth } from "./lib/auth.middleware";
import { keepBlobBody } from "./lib/blob-body";
import type { Db } from "./lib/db";
import { mapError, safeErrorFields, toErrorBody } from "./lib/errors";
import { dbHubAudit, type HubAuditWriter } from "./lib/hub-audit";
import { type Logger, logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { closeUnreadBody } from "./lib/unread-body";
import type { AttachmentDeps } from "./modules/attachments/storage";
import { type ConfigCache, startConfigCache } from "./modules/config/config.service";
import { conversationRoutes } from "./modules/conversations/conversations.routes";
import { conversationService } from "./modules/conversations/conversations.service";
import { cancelRoutes } from "./modules/runs/close/cancel.routes";
import { CancelService } from "./modules/runs/close/cancel.service";
import { runRoutes, sendMessageRoutes } from "./modules/runs/runs.routes";
import { type RunDriver, RunService } from "./modules/runs/runs.service";
import { traceRoutes } from "./modules/runs/trace/trace.routes";
import { TraceService } from "./modules/runs/trace/trace.service";

/** `config` có khi app dựng kèm `db` (cache cấu hình, plan §4); `user` chỉ có sau `requireAuth` (`PROTECTED_PREFIXES`). */
export type AppVars = {
  Variables: { requestId: string; log: Logger; config?: ConfigCache; user: AuthUser };
};
export type AppConfig = { version: string; corsOrigins: string[] };
/** Kiểm phụ thuộc cho /health; ném lỗi = không sẵn sàng → 503. Vắng (test khung) → luôn ok. */
export type HealthProbe = () => Promise<void>;
/**
 * Phụ thuộc của app (seam test ↔ hub-api: spec-decisions QW-A1, QW-A2). Mọi trường tuỳ chọn; vắng `db` ⇒ không có vòng nền
 * (test khung). Có `db` ⇒ vòng nền tự chạy ngay trong `createApp` và dừng khi `signal` abort.
 */
export type AppDeps = {
  probes?: HealthProbe[];
  db?: Db;
  redis?: Redis;
  jwtPublicKey?: CryptoKey;
  appEnv?: "development" | "test" | "production";
  /** = `HUB_INSTANCE_ID` (chủ run/lease). */
  instanceId?: string;
  /** = `HUB_JOB_MAX_WAIT_S`. */
  jobMaxWaitS?: number;
  /** = `HUB_CONFIG_POLL_S` (mặc định 60). */
  configPollS?: number;
  signal?: AbortSignal;
  /** Vòng chạy run. Vắng → vòng Orchestrator (B8) qua `JobAgentRunner` (B7). */
  runDriver?: RunDriver;
  /** H2a · = `SECRET_MASTER_KEY` (base64 32 byte, chung Admin); nạp bằng `loadMasterKey` (dify/credential.service). */
  secretMasterKey?: string;
  /** H2a · = `HUB_INTERNAL_TOKEN` (vắng → `/internal/test-run` 503). */
  internalToken?: string;
  /** H2a · = `HUB_PUBLIC_INTERNAL_URL` (dựng `mcp.url` = `<url>/mcp`). */
  publicInternalUrl?: string;
  /** H2a · = `HUB_DIFY_TIMEOUT_MAX_S` (mặc định 300). */
  difyTimeoutMaxS?: number;
  /** H2b · = `HUB_MAX_CONCURRENT_RUNS` (server điền, mặc định 2). Vắng ⇒ không giới hạn (L1: test khoá H1/H2a). */
  maxConcurrentRuns?: number;
  /** H2c · storage + hạn mức + sweeper (`HUB_ATTACH_*`, server điền). Vắng ⇒ không mount route file (PL14). */
  attachments?: AttachmentDeps;
  /** H3b · ghi `hub.audit_log` (grant/revoke/view_trace). Vắng ⇒ `dbHubAudit`; test tiêm lỗi giữa transaction (P12). */
  hubAudit?: HubAuditWriter;
  studioDist?: string; // H4a · = `HUB_STUDIO_DIST` (dist Studio; vắng ⇒ `/studio` 404, P12).
};

const DEFAULT_CONFIG_POLL_S = 60;
/** Gốc các route cần JWT (E5–E15). Chặn ở gốc ⇒ 401 trước 404, kể cả route chưa mount; `/health` mở. */
const PROTECTED_PREFIXES = [
  "/conversations",
  "/runs",
  "/commands",
  "/agents",
  "/attachments",
  "/agent-grants",
  "/studio/api",
  ...X2A_PROTECTED_PREFIXES,
];

const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Client",
  "Last-Event-ID",
  REQUEST_ID_HEADER,
  FILENAME_HEADER,
];

function healthRoutes(cfg: AppConfig, probes: HealthProbe[]): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.get("/", async (c) => {
    const results = await Promise.allSettled(probes.map((p) => p()));
    const failed = results.find((x): x is PromiseRejectedResult => x.status === "rejected");
    if (failed) {
      c.get("log").warn("health-unavailable", safeErrorFields(failed.reason));
      return c.json(toErrorBody("INTERNAL_ERROR", "Service unavailable"), 503);
    }
    // `.parse`: version sai định dạng thành 500, không trả body sai contract.
    return c.json(HealthResponseSchema.parse({ status: "ok", version: cfg.version }));
  });
  return r;
}

/** `runs.owner` của instance (= `HUB_INSTANCE_ID`; test khung vắng → host:pid). */
const instanceOwner = (deps: AppDeps): string => deps.instanceId ?? `${hostname()}:${process.pid}`;

/** H2a · driver lệnh `/` (B5 sync Dify, B6 async qua job `workflow.async`). */
function commandDrivers(deps: AppDeps, db: Db) {
  return commandDriverFor({
    db,
    log: logger,
    secretMasterKey: deps.secretMasterKey,
    storage: deps.attachments?.storage,
    jobs: workflowJobs({ ...deps, db, owner: instanceOwner(deps), log: logger }),
  });
}

/**
 * JWT ở gốc `PROTECTED_PREFIXES` (`/x/*` của Hono khớp cả `/x`) + route E5–E14. Vắng `db` (test khung) ⇒ không mount;
 * E12–E14 cần thêm `redis` + cache cấu hình. B6: kèm `/internal/jobs/:job_id/dify-credential` (ngoài `PROTECTED_PREFIXES`,
 * không JWT — token job).
 */
function mountProtected(app: Hono<AppVars>, deps: AppDeps, config?: ConfigCache): void {
  const auth = requireAuth(deps.jwtPublicKey);
  for (const p of PROTECTED_PREFIXES) app.use(`${p}/*`, auth);
  mountH4a(app, { ...deps, log: logger });
  if (!deps.db) return;
  mountX2a(app, { db: deps.db, redis: deps.redis, log: logger });
  const drivers = commandDrivers(deps, deps.db);
  if (config) mountDifyCredential(app, { ...deps, db: deps.db, config, log: logger });
  const h2a = config && mountH2a(app, config, drivers);
  const h2b = config && mountH2b(app, config);
  if (config) mountH3b(app, { db: deps.db, config, hubAudit: deps.hubAudit });
  // H3b §5.4: trace chỉ cần db (không redis/config); `/runs/:id/trace` không đụng `GET /runs/:id` (R20).
  app.route(
    "/runs",
    traceRoutes(new TraceService({ db: deps.db, audit: deps.hubAudit ?? dbHubAudit })),
  );
  if (!deps.redis || !config || !h2a || !h2b) {
    app.route("/conversations", conversationRoutes(deps.db));
    return;
  }
  const base = { ...deps, db: deps.db, redis: deps.redis, owner: instanceOwner(deps), log: logger };
  const { owner } = base;
  const runs = new RunService({ ...base, config, ...runDrivers({ ...base, config }) });
  const conversations = conversationService(deps.db);
  const cancel = new CancelService({
    db: deps.db,
    redis: deps.redis,
    owner,
    registry: runs.registry,
    conversations,
    log: logger,
  });
  app.route(
    "/conversations",
    conversationRoutes(deps.db, (u, id) => cancel.removeConversation(u, id)),
  );
  app.route(
    "/conversations",
    sendMessageRoutes(conversations, runs, h2a.prepareCommand, h2b.prepareMention),
  );
  app.route("/runs", runRoutes(runs));
  app.route("/runs", cancelRoutes(cancel));
  startRunLoops({ ...base, registry: runs.registry });
}

/** request_id → logger child → cache cấu hình; log một dòng mỗi request. Không bao giờ log body, Authorization, Cookie (CONVENTIONS §5, A52). */
function requestContext(config?: ConfigCache): MiddlewareHandler<AppVars> {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", id);
    c.set("log", logger.child({ request_id: id }));
    if (config) c.set("config", config);
    const t0 = performance.now();
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, id);
    c.get("log").info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round((performance.now() - t0) * 10) / 10,
    });
  };
}

export function createApp(cfg: AppConfig, deps: AppDeps = {}): Hono<AppVars> {
  const app = new Hono<AppVars>();
  const config = deps.db
    ? startConfigCache(deps.db, {
        pollS: deps.configPollS ?? DEFAULT_CONFIG_POLL_S,
        log: logger,
        signal: deps.signal,
      })
    : undefined;

  app.use(requestContext(config));
  app.use(closeUnreadBody());
  app.use(keepBlobBody());
  app.use(
    cors({
      origin: cfg.corsOrigins,
      credentials: true,
      allowHeaders: ALLOW_HEADERS,
      exposeHeaders: [
        REQUEST_ID_HEADER,
        RUN_ID_HEADER,
        FLOW_ID_HEADER,
        MESSAGE_ID_HEADER,
        RETRY_AFTER_HEADER,
        "Content-Disposition",
      ],
    }),
  );

  app.route("/health", healthRoutes(cfg, deps.probes ?? []));
  mountProtected(app, deps, config);
  if (deps.db && config) mountMcp(app, { ...deps, db: deps.db, config, log: logger });
  if (deps.db && config) mountTestRun(app, { ...deps, db: deps.db, config, log: logger });
  if (deps.db && deps.attachments)
    mountH2c(app, { db: deps.db, attachments: deps.attachments, log: logger, signal: deps.signal });

  app.notFound((c) => c.json(toErrorBody("NOT_FOUND", "Not found"), 404));
  app.onError((err, c) => {
    const { status, body, headers } = mapError(err);
    if (status >= 500) c.get("log").error("unhandled", safeErrorFields(err));
    return c.json(body, status, headers);
  });

  return app;
}
