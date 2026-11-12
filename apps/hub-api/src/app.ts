// HUB-NFR-04 · H1-R26 · dựng app Hono của hub-api (plan H1 §4). Factory thuần: không đọc env, để test in-process.
// Middleware: request_id → logger (child có request_id) → CORS. Lỗi theo `CHAT_API_ERRORS` (contract chat).

import {
  FILENAME_HEADER,
  FLOW_ID_HEADER,
  HealthResponseSchema,
  MESSAGE_ID_HEADER,
  PROCESS_RUN_ID_HEADER,
  RETRY_AFTER_HEADER,
  RUN_ID_HEADER,
} from "@ai/contracts/chat";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { mountDifyCredential } from "./app.async";
import type { AppDeps, HealthProbe } from "./app.deps";
import { bindDlcAgents } from "./app.dlc";
import { mountH2a, mountTestRun } from "./app.h2a";
import { mountH2b } from "./app.h2b";
import { mountH2c } from "./app.h2c";
import { mountH3b } from "./app.h3b";
import { mountH4a } from "./app.h4a";
import { mountMcp } from "./app.mcp";
import { withPackBridges } from "./app.n2";
import { mountNotifyAndRelay } from "./app.notify";
import { runDrivers, slotDefaultsOf, startRunLoops } from "./app.runner";
import {
  commandDrivers,
  contextLabelerOf,
  contractsReader,
  instanceOwner,
  processHooks,
} from "./app.wiring";
import { mountRoomAgents, mountX2a, roomPoster, X2A_PROTECTED_PREFIXES } from "./app.x2a";
import { type AuthUser, type ChatDock, requireAuth } from "./lib/auth.middleware";
import { keepBlobBody } from "./lib/blob-body";
import type { Db } from "./lib/db";
import { mapError, safeErrorFields, toErrorBody } from "./lib/errors";
import { dbHubAudit } from "./lib/hub-audit";
import { type Logger, logger } from "./lib/logger";
import { redactPath, traceRequest } from "./lib/request-span";
import { closeUnreadBody } from "./lib/unread-body";
import { mountCapabilities } from "./modules/capabilities/capabilities.mount";
import { chatGate } from "./modules/chat-gate/chat-gate.middleware";
import { CHAT_GATED_PREFIXES } from "./modules/chat-gate/chat-gate.rules";
import { type ConfigCache, startConfigCache } from "./modules/config/public";
import { conversationRoutes } from "./modules/conversations/conversations.routes";
import { conversationService } from "./modules/conversations/conversations.service";
import { mountApplyResult } from "./modules/internal/apply.routes";
import { mountSourceCredential } from "./modules/internal/source-credential.routes";
import { NOTIFICATIONS_PREFIX } from "./modules/notify/adapters/notify.routes";
import { mountOps, OPS_PREFIX } from "./modules/ops/ops.mount";
import { externalFirewall } from "./modules/packs/kit/public";
import { mountEsignWebhook, mountPacks, PACK_PREFIX } from "./modules/packs/packs.mount";
import { PROCESS_PROTECTED_PREFIXES } from "./modules/processes/processes.mount";
import { PROCESS_ROUTES_HEADER } from "./modules/processes/routes-mode";
import { cancelRoutes } from "./modules/runs/close/cancel.routes";
import { CancelService } from "./modules/runs/close/cancel.service";
import { runRoutes, sendMessageRoutes } from "./modules/runs/runs.routes";
import { RunService } from "./modules/runs/runs.service";
import { traceRoutes } from "./modules/runs/trace/trace.routes";
import { TraceService } from "./modules/runs/trace/trace.service";
import { SECRETS_PROTECTED_PREFIXES } from "./modules/secrets/secrets.mount";
import type { ResolveBridge } from "./modules/sources/resolve.bridge";
import { mountSources, SOURCE_PROTECTED_PREFIXES } from "./modules/sources/sources.mount";
// HUB-NFR-04 · H1-R26 · dựng app Hono của hub-api (plan H1 §4). Factory thuần: không đọc env, để test in-process.
// Middleware: request_id → logger (child có request_id) → CORS. Lỗi theo `CHAT_API_ERRORS` (contract chat).

/** `config` có khi app dựng kèm `db` (cache cấu hình, plan §4); `user` chỉ có sau `requireAuth` (`PROTECTED_PREFIXES`). */
export type AppVars = {
  Variables: {
    requestId: string;
    log: Logger;
    config?: ConfigCache;
    user: AuthUser;
    chatDock?: ChatDock;
    chatOff?: boolean;
  };
};
export type AppConfig = { version: string; corsOrigins: string[] };
export type { AppDeps, HealthProbe };

const DEFAULT_CONFIG_POLL_S = 60;
/** Gốc các route cần JWT (E5–E15). Chặn ở gốc ⇒ 401 trước 404, kể cả route chưa mount; `/health` mở. */
const PROTECTED_PREFIXES = [
  "/conversations",
  "/runs",
  "/commands",
  "/agents",
  "/attachments",
  "/agent-grants",
  "/agent-settings",
  "/studio/api",
  PACK_PREFIX,
  NOTIFICATIONS_PREFIX,
  OPS_PREFIX,
  ...X2A_PROTECTED_PREFIXES,
  ...PROCESS_PROTECTED_PREFIXES,
  ...SOURCE_PROTECTED_PREFIXES,
  ...SECRETS_PROTECTED_PREFIXES,
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
  "X-Ai-Surface", // usage-analytics (AI_SURFACE_HEADER)
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

/** Route chỉ cần `db` (+ `config` nếu có): phòng X2a, lệnh/`@`, quyền agent, trace, nguồn. Trả phần cần cho vòng run. */
function mountDbRoutes(app: Hono<AppVars>, deps: AppDeps & { db: Db }, config?: ConfigCache) {
  const frozenOn = deps.frozenModules !== false; // F1 (CR-095): false ⇒ không mount route công khai module đóng băng
  const x2a = mountX2a(app, { ...deps, log: logger, rooms: frozenOn }); // + `meConns` (CR-118 N3)
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
  // P-b · nguồn: mount TRƯỚC module quy trình để `/process-runs/sources` không bị `/process-runs/:id` nuốt.
  // Bridge chung: module nguồn nhận `/sources-resolved`, engine quy trình (mount sau) gắn `onReport`.
  const resolveBridge: ResolveBridge = {};
  if (frozenOn)
    mountSources(app, {
      db: deps.db,
      sourceCheckTimeoutMs: deps.sourceCheckTimeoutMs,
      resolveBridge,
      now: deps.now,
    });
  return { x2a, h2a, h2b, resolveBridge };
}

/**
 * JWT ở gốc `PROTECTED_PREFIXES` (`/x/*` của Hono khớp cả `/x`) + route E5–E14. Vắng `db` (test khung) ⇒ không mount;
 * E12–E14 cần thêm `redis` + cache cấu hình. B6: kèm `/internal/jobs/:job_id/dify-credential` (ngoài PREFIXES, token job). */
function mountProtected(app: Hono<AppVars>, deps: AppDeps, config?: ConfigCache) {
  const auth = requireAuth(deps.jwtPublicKey);
  for (const p of PROTECTED_PREFIXES) app.use(`${p}/*`, auth);
  // CR-102a · com-c2-ext-deny: đối tác chỉ qua gói `EXTERNAL_PACKS` + chuông; còn lại 403 (từ chối mặc định).
  const firewall = externalFirewall();
  for (const p of PROTECTED_PREFIXES) app.use(`${p}/*`, firewall);
  if (config) {
    // chat-api-gate · SAU auth: công ty bị thu hồi `chat-app` ⇒ 403 CHAT_APP_DISABLED (trừ dock Sổ Hợp Tác có quyền đọc gói).
    const gate = chatGate({ view: config, dockAllowed: contractsReader(config) });
    for (const p of CHAT_GATED_PREFIXES) app.use(`${p}/*`, gate);
  }
  const kh = mountH4a(app, { ...deps, log: logger });
  if (!deps.db) return kh;
  const { signal } = deps;
  const { x2a, h2a, h2b, resolveBridge } = mountDbRoutes(app, { ...deps, db: deps.db }, config);
  if (!deps.redis || !config || !h2a || !h2b) {
    app.route("/conversations", conversationRoutes(deps.db));
    return kh;
  }
  const { onClosed } = roomPoster({ db: deps.db, redis: deps.redis, log: logger, signal });
  const base = { ...deps, db: deps.db, redis: deps.redis, owner: instanceOwner(deps), log: logger };
  const { owner } = base;
  const runs = new RunService({ ...base, config, onClosed, ...runDrivers({ ...base, config }) });
  const conversations = conversationService(deps.db);
  const cancel = new CancelService({
    db: deps.db,
    redis: deps.redis,
    owner,
    registry: runs.registry,
    conversations,
    log: logger,
    onClosed,
  });
  mountRoomAgents(x2a, { runs, prepareMention: h2b.prepareMention, config, cancel, log: logger });
  app.route(
    "/conversations",
    conversationRoutes(deps.db, (u, id) => cancel.removeConversation(u, id)),
  );
  const processStart = processHooks(app, deps, {
    ...base,
    config,
    runs,
    messages: x2a.messages,
    // CR-056 · HUB-FR-115 · kho file cho engine ghi blob output stage (vắng ⇒ không tạo hàng attachment output).
    storage: deps.attachments?.storage,
    resolveBridge,
    kh,
  });
  const prepare = {
    command: h2a.prepareCommand,
    mention: h2b.prepareMention,
    processStart,
    context: contextLabelerOf(deps.packTools), // one-agent · nhãn bản ghi đang xem (RLS gói)
  };
  app.route("/conversations", sendMessageRoutes(conversations, runs, prepare));
  // dlc-engine · bước DLC (engine quy trình) chạy agent trong hội thoại + sinh agent domain/QC — qua cầu của gói `dlc`.
  bindDlcAgents(deps.dlcAgents, {
    ...base,
    runs,
    prepareMention: h2b.prepareMention,
    packTools: deps.packTools,
  });
  app.route("/runs", runRoutes(runs));
  app.route("/runs", cancelRoutes(cancel));
  startRunLoops({ ...base, registry: runs.registry });
  return kh;
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
    await traceRequest(c, async () => {
      await next();
      c.res.headers.set(REQUEST_ID_HEADER, id);
      c.get("log").info("request", {
        method: c.req.method,
        path: redactPath(c.req.path), // CR-124 · q5 · token trong link email không vào log
        status: c.res.status,
        ms: Math.round((performance.now() - t0) * 10) / 10,
      });
    });
  };
}
const corsOf = (cfg: AppConfig): MiddlewareHandler =>
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
      PROCESS_RUN_ID_HEADER,
      PROCESS_ROUTES_HEADER, // fnr-fix-unfreeze · admin-web đọc chế độ route quy trình
      "Content-Disposition",
    ],
  });

export function createApp(cfg: AppConfig, depsIn: AppDeps = {}): Hono<AppVars> {
  const deps = withPackBridges(depsIn); // N2 · cầu gói ↔ engine
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
  app.use(corsOf(cfg));

  app.route("/health", healthRoutes(cfg, deps.probes ?? []));
  // cf-esign-docusign · webhook ký số gắn TRƯỚC JWT `/pack/*` (nhà cung cấp tự xác thực, map envelope ⇒ tenant qua bảng).
  const esign = mountEsignWebhook(app, deps); // vắng db (⇔ vắng config) ⇒ undefined
  const { meConns } = mountCapabilities(app, { ...deps, config }); // CR-118 · tự gắn JWT; vắng db ⇒ không mount
  const kh = mountProtected(app, { ...deps, meConns }, config);
  if (config) mountPacks(app, { ...deps, config, esign }); // N1 · `/pack/:k/me` + route gói (pkdemo)
  slotDefaultsOf(deps, config); // CR-120 · sau khi gói đã đăng ký khe
  if (deps.db) {
    mountNotifyAndRelay(app, { ...deps, db: deps.db, log: logger }); // N3 + CR-121 c21b
    mountOps(app, { ...deps, db: deps.db, log: logger }); // CR-104 · ops-watch (không phụ thuộc module đóng băng)
  }
  if (deps.db && config) mountMcp(app, { ...deps, db: deps.db, config, log: logger, kh });
  if (deps.db && config) mountTestRun(app, { ...deps, db: deps.db, config, log: logger });
  if (deps.db && deps.attachments)
    mountH2c(app, { db: deps.db, attachments: deps.attachments, log: logger, signal: deps.signal });
  // P-c2 B4 · `/internal/jobs/:id/source-credential` (token job, không JWT/CORS; khoá nguồn riêng cho Runtime).
  if (deps.db)
    mountSourceCredential(app, { db: deps.db, key: deps.hubSecretsKey ?? null, log: logger });
  // P-c2 B5 · `/internal/jobs/:id/apply-result` (token job; blob log test cùng kho file — chỉ khi có `attachments`).
  if (deps.db && deps.attachments)
    mountApplyResult(app, { db: deps.db, storage: deps.attachments.storage, log: logger });

  app.notFound((c) => c.json(toErrorBody("NOT_FOUND", "Not found"), 404));
  app.onError((err, c) => {
    const { status, body, headers } = mapError(err);
    if (status >= 500) c.get("log").error("unhandled", safeErrorFields(err));
    return c.json(body, status, headers);
  });

  return app;
}
