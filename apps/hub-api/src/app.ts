// HUB-NFR-04 · H1-R26 · dựng app Hono của hub-api (plan H1 §4). Factory thuần: không đọc env, để test in-process.
// Middleware: request_id → logger (child có request_id) → CORS. Lỗi theo `CHAT_API_ERRORS` (contract chat).

import { hostname } from "node:os";
import {
  FLOW_ID_HEADER,
  HealthResponseSchema,
  MESSAGE_ID_HEADER,
  RUN_ID_HEADER,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mountH2a } from "./app.h2a";
import { mountMcp, runnerMcp } from "./app.mcp";
import { type AuthUser, requireAuth } from "./lib/auth.middleware";
import type { Db } from "./lib/db";
import { mapError, safeErrorFields, toErrorBody } from "./lib/errors";
import { type Logger, logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { type ConfigCache, startConfigCache } from "./modules/config/config.service";
import { conversationRoutes } from "./modules/conversations/conversations.routes";
import { conversationService } from "./modules/conversations/conversations.service";
import { orchestratorDriver } from "./modules/orchestrator/orchestrator.service";
import { JobAgentRunner } from "./modules/runner/job-agent-runner";
import { startOrphanSweep } from "./modules/runner/orphan-sweep";
import { RunStreamReader } from "./modules/runner/run-stream-reader";
import { cancelRoutes } from "./modules/runs/close/cancel.routes";
import { CancelService } from "./modules/runs/close/cancel.service";
import { startLeaseLoop } from "./modules/runs/close/lease";
import { startLeaseSweeper } from "./modules/runs/close/sweeper";
import { runRoutes, sendMessageRoutes } from "./modules/runs/runs.routes";
import { type RunDriver, RunService } from "./modules/runs/runs.service";
import type { RunRegistry } from "./modules/runs/sse/sse-writer";

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
};

const DEFAULT_CONFIG_POLL_S = 60;
/** = `HUB_JOB_MAX_WAIT_S` mặc định (plan §7). */
const DEFAULT_JOB_MAX_WAIT_S = 30;
/** Gốc các route cần JWT (E5–E15). Chặn ở gốc ⇒ 401 trước 404, kể cả route chưa mount; `/health` mở. */
const PROTECTED_PREFIXES = ["/conversations", "/runs", "/commands"];

const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Client",
  "Last-Event-ID",
  REQUEST_ID_HEADER,
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

/** B8 · vòng Orchestrator (plan §6) chạy job qua runner B7 (§5.6); dừng theo `deps.signal`. */
function defaultRunDriver(db: Db, redis: Redis, deps: AppDeps, config: ConfigCache): RunDriver {
  const reader = new RunStreamReader(redis, logger, deps.signal);
  const maxWaitS = deps.jobMaxWaitS ?? DEFAULT_JOB_MAX_WAIT_S;
  const runner = new JobAgentRunner({
    db,
    owner: instanceOwner(deps),
    reader,
    maxWaitS,
    log: logger,
    mcp: runnerMcp(deps.publicInternalUrl, config),
  });
  return orchestratorDriver({ db, runner, users: config, log: logger });
}

/** B10 · vòng nền của instance (plan §5.2 lease, §5.8 sweeper lease, plan-db §5.5 orphan); dừng khi `signal` abort. */
function startRunLoops(d: {
  db: Db;
  redis: Redis;
  owner: string;
  registry: RunRegistry;
  signal?: AbortSignal;
}): void {
  const deps = { ...d, log: logger };
  startLeaseLoop(deps);
  startLeaseSweeper(deps);
  startOrphanSweep(deps);
}

/**
 * JWT ở gốc `PROTECTED_PREFIXES` (`/x/*` của Hono khớp cả `/x`) + route E5–E14. Vắng `db` (test khung) ⇒ không mount;
 * E12–E14 cần thêm `redis` + cache cấu hình.
 */
function mountProtected(app: Hono<AppVars>, deps: AppDeps, config?: ConfigCache): void {
  const auth = requireAuth(deps.jwtPublicKey);
  for (const p of PROTECTED_PREFIXES) app.use(`${p}/*`, auth);
  if (!deps.db) return;
  const h2a = config && mountH2a(app, config);
  if (!deps.redis || !config || !h2a) {
    app.route("/conversations", conversationRoutes(deps.db));
    return;
  }
  const owner = instanceOwner(deps);
  const runs = new RunService({
    db: deps.db,
    redis: deps.redis,
    config,
    owner,
    driver: deps.runDriver ?? defaultRunDriver(deps.db, deps.redis, deps, config),
    log: logger,
    signal: deps.signal,
  });
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
  app.route("/conversations", sendMessageRoutes(conversations, runs, h2a.prepareCommand));
  app.route("/runs", runRoutes(runs));
  app.route("/runs", cancelRoutes(cancel));
  startRunLoops({
    db: deps.db,
    redis: deps.redis,
    owner,
    registry: runs.registry,
    signal: deps.signal,
  });
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

  // Không bao giờ log body, Authorization, Cookie (CONVENTIONS §5, A52).
  app.use(async (c, next) => {
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
  });
  app.use(
    cors({
      origin: cfg.corsOrigins,
      credentials: true,
      allowHeaders: ALLOW_HEADERS,
      exposeHeaders: [REQUEST_ID_HEADER, RUN_ID_HEADER, FLOW_ID_HEADER, MESSAGE_ID_HEADER],
    }),
  );

  app.route("/health", healthRoutes(cfg, deps.probes ?? []));
  mountProtected(app, deps, config);
  if (deps.db && config) mountMcp(app, { ...deps, db: deps.db, config, log: logger });

  app.notFound((c) => c.json(toErrorBody("NOT_FOUND", "Not found"), 404));
  app.onError((err, c) => {
    const { status, body } = mapError(err);
    if (status >= 500) c.get("log").error("unhandled", safeErrorFields(err));
    return c.json(body, status);
  });

  return app;
}
