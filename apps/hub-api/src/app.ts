// HUB-NFR-04 · H1-R26 · dựng app Hono của hub-api (plan H1 §4). Factory thuần: không đọc env, để test in-process.
// Middleware: request_id → logger (child có request_id) → CORS. Lỗi theo `CHAT_API_ERRORS` (contract chat).

import { hostname } from "node:os";
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
import { mountDifyCredential, workflowJobs } from "./app.async";
import type { AppDeps, HealthProbe } from "./app.deps";
import { commandDriverFor, mountH2a, mountTestRun } from "./app.h2a";
import { mountH2b } from "./app.h2b";
import { mountH2c } from "./app.h2c";
import { mountH3b } from "./app.h3b";
import { mountH4a } from "./app.h4a";
import { mountMcp, sharedWorkflowInvoker } from "./app.mcp";
import { withPackBridges } from "./app.n2";
import { processAgentRunner, runDrivers, startRunLoops } from "./app.runner";
import {
  mountRoomAgents,
  mountX2a,
  roomPoster,
  X2A_PROTECTED_PREFIXES,
  type X2aMounted,
} from "./app.x2a";
import { type AuthUser, type ChatDock, requireAuth } from "./lib/auth.middleware";
import { keepBlobBody } from "./lib/blob-body";
import type { Db } from "./lib/db";
import { mapError, safeErrorFields, toErrorBody } from "./lib/errors";
import { dbHubAudit } from "./lib/hub-audit";
import { type Logger, logger } from "./lib/logger";
import { closeUnreadBody } from "./lib/unread-body";
import { chatGate } from "./modules/chat-gate/chat-gate.middleware";
import { CHAT_GATED_PREFIXES } from "./modules/chat-gate/chat-gate.rules";
import { type ConfigCache, startConfigCache } from "./modules/config/config.service";
import { conversationRoutes } from "./modules/conversations/conversations.routes";
import { conversationService } from "./modules/conversations/conversations.service";
import { dlcRoutes } from "./modules/dlc/dlc.routes";
import { dlcAdminRoutes } from "./modules/dlc/dlc-admin.routes";
import { mountApplyResult } from "./modules/internal/apply.routes";
import { mountSourceCredential } from "./modules/internal/source-credential.routes";
import type { KhRuntime } from "./modules/kh/kh.mount";
import { NOTIFICATIONS_PREFIX } from "./modules/notify/adapters/notify.routes";
import { mountNotify } from "./modules/notify/notify.mount";
import { externalFirewall } from "./modules/packs/kit/adapters/external-firewall.middleware";
import { packAccessInput } from "./modules/packs/kit/adapters/pack-guard.middleware";
import type { ContextLabeler } from "./modules/packs/kit/application/context.ports";
import { checkPackAccess } from "./modules/packs/kit/domain/pack-access.rules";
import { mountEsignWebhook, mountPacks, PACK_PREFIX } from "./modules/packs/packs.mount";
import type { ProcessStartPort } from "./modules/processes/core/ports";
import {
  mountProcesses,
  PROCESS_PROTECTED_PREFIXES,
  type ProcessMountDeps,
  type ProcessSeams,
} from "./modules/processes/processes.mount";
import { cancelRoutes } from "./modules/runs/close/cancel.routes";
import { CancelService } from "./modules/runs/close/cancel.service";
import { runRoutes, sendMessageRoutes } from "./modules/runs/runs.routes";
import { RunService } from "./modules/runs/runs.service";
import { traceRoutes } from "./modules/runs/trace/trace.routes";
import { TraceService } from "./modules/runs/trace/trace.service";
import { SECRETS_PROTECTED_PREFIXES } from "./modules/secrets/secrets.mount";
import { HubSecretReader } from "./modules/secrets/secrets.use";
import type { ResolveBridge } from "./modules/sources/resolve.bridge";
import { mountSources, SOURCE_PROTECTED_PREFIXES } from "./modules/sources/sources.mount";

/** `config` có khi app dựng kèm `db` (cache cấu hình, plan §4); `user` chỉ có sau `requireAuth` (`PROTECTED_PREFIXES`). */
export type AppVars = {
  Variables: {
    requestId: string;
    log: Logger;
    config?: ConfigCache;
    user: AuthUser;
    chatDock?: ChatDock;
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
  "/dlc",
  PACK_PREFIX,
  NOTIFICATIONS_PREFIX,
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

/** P-c2 · C13 · endpoint GitHub: seam `deps.github` ưu tiên; ngược lại env `HUB_GITHUB_*` (vắng ⇒ undefined ⇒ không mở PR). */
function githubEndpointOf(deps: AppDeps): { apiUrl: string; webHost: string } | undefined {
  if (deps.github) return deps.github;
  const apiUrl = process.env.HUB_GITHUB_API_URL;
  const webHost = process.env.HUB_GITHUB_WEB_HOST;
  return apiUrl && webHost ? { apiUrl, webHost } : undefined;
}

/** Seam N3 (plan-contract §7.1) chuyển nguyên cho module quy trình. */
const seamsOf = (d: AppDeps): ProcessSeams => ({
  processRunsPerTenant: d.processRunsPerTenant,
  stageLauncher: d.stageLauncher,
  now: d.now,
  processLoops: d.processLoops,
  onProcessHandles: d.onProcessHandles,
  ...{ packRuns: d.packRuns, packTools: d.packTools }, // N2-FR-01/03
});

/** one-agent · cổng nhãn ngữ cảnh từ registry tool gói (vắng ⇒ không nhắc bản ghi). */
const contextLabelerOf = (t: AppDeps["packTools"]): ContextLabeler | undefined => {
  const f = t?.contextLabel;
  return f && t ? { contextLabel: f.bind(t) } : undefined;
};

/** chat-api-gate · dock trợ lý mở cho user có quyền `read` gói của dock (`contracts` = Sổ Hợp Tác, `community` = com-c10b;
 *  cùng luật cổng gói, đọc cache). */
const contractsReader =
  (config: ConfigCache) =>
  async (u: AuthUser, surface: "contracts" | "community"): Promise<boolean> => {
    const i = await packAccessInput(config, surface, u);
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read }) === "ok";
  };

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

/** P-a D15 · cờ bật: module quy trình + runner stage (N4) + nối `!` vào phòng (T1/T7); trả cổng `!` Hỏi AI (D14). */
function processHooks(
  app: Hono<AppVars>,
  deps: AppDeps,
  m: Omit<ProcessMountDeps, keyof ProcessSeams | "runner"> & {
    config: ConfigCache;
    messages: X2aMounted["messages"];
    resolveBridge?: ResolveBridge;
    kh?: KhRuntime;
  },
): ProcessStartPort | undefined {
  if (!deps.processEngine) return undefined;
  const runner = processAgentRunner({ ...deps, ...m, kh: m.kh, owner: instanceOwner(deps) });
  const proc = mountProcesses(app, {
    ...m,
    runner,
    signal: deps.signal,
    ...seamsOf(deps),
    resolveBridge: m.resolveBridge,
    workflowInvoker: sharedWorkflowInvoker({ ...deps, ...m }), // P-d2 · D2-02 · chung với `/mcp`
    // P-c2 · C13 · endpoint GitHub (seam ưu tiên env) + reader khoá nguồn cho driver stage Áp (mở PR).
    github: githubEndpointOf(deps),
    publicRoutes: deps.frozenModules !== false, // F1 · route công khai quy trình chỉ khi module không đóng băng
    secrets: new HubSecretReader({ db: m.db, key: deps.hubSecretsKey ?? null, log: logger }),
  });
  m.messages.useProcesses(proc.roomSender);
  return proc.conversationStart;
}

/** Route chỉ cần `db` (+ `config` nếu có): phòng X2a, lệnh/`@`, quyền agent, trace, nguồn. Trả phần cần cho vòng run. */
function mountDbRoutes(app: Hono<AppVars>, deps: AppDeps & { db: Db }, config?: ConfigCache) {
  // DLC-R11 · Workspaces/Process (AI SDLC) — chỉ cần db; engine vắng ⇒ route trả engine: not_configured.
  const frozenOn = deps.frozenModules !== false; // F1 (CR-095): false ⇒ không mount route công khai module đóng băng
  if (frozenOn) {
    app.route("/dlc", dlcRoutes(deps.db, deps.dlc));
    app.route("/dlc", dlcAdminRoutes(deps.db, deps.dlc));
  }
  const { redis, pingMs, signal } = deps;
  const x2a = mountX2a(app, { db: deps.db, redis, log: logger, pingMs, signal, rooms: frozenOn });
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
 * E12–E14 cần thêm `redis` + cache cấu hình. B6: kèm `/internal/jobs/:job_id/dify-credential` (ngoài `PROTECTED_PREFIXES`,
 * không JWT — token job).
 */
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
  const kh = mountProtected(app, deps, config);
  if (config) mountPacks(app, { ...deps, config, esign }); // N1 · `/pack/:k/me` + route gói (pkdemo)
  if (deps.db) mountNotify(app, { ...deps, db: deps.db, log: logger }); // N3
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
