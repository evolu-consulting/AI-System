// HUB-NFR-04 · H1-R26 · dựng app Hono của hub-api (plan H1 §4). Factory thuần: không đọc env, để test in-process.
// Middleware: request_id → logger (child có request_id) → CORS. Lỗi theo `CHAT_API_ERRORS` (contract chat).
import { HealthResponseSchema } from "@ai/contracts/chat";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthUser, requireAuth } from "./lib/auth.middleware";
import type { Db } from "./lib/db";
import { mapError, safeErrorFields, toErrorBody } from "./lib/errors";
import { type Logger, logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { type ConfigCache, startConfigCache } from "./modules/config/config.service";
import { conversationRoutes } from "./modules/conversations/conversations.routes";

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
};

const DEFAULT_CONFIG_POLL_S = 60;
/** Gốc các route cần JWT (E5–E15). Chặn ở gốc ⇒ 401 trước 404, kể cả route chưa mount; `/health` mở. */
const PROTECTED_PREFIXES = ["/conversations", "/runs"];

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

/** JWT ở gốc `PROTECTED_PREFIXES` (`/x/*` của Hono khớp cả `/x`) + route E5–E11. Vắng `db` (test khung) ⇒ không mount. */
function mountProtected(app: Hono<AppVars>, deps: AppDeps): void {
  const auth = requireAuth(deps.jwtPublicKey);
  for (const p of PROTECTED_PREFIXES) app.use(`${p}/*`, auth);
  if (deps.db) app.route("/conversations", conversationRoutes(deps.db));
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
      exposeHeaders: [REQUEST_ID_HEADER],
    }),
  );

  app.route("/health", healthRoutes(cfg, deps.probes ?? []));
  mountProtected(app, deps);

  app.notFound((c) => c.json(toErrorBody("NOT_FOUND", "Not found"), 404));
  app.onError((err, c) => {
    const { status, body } = mapError(err);
    if (status >= 500) c.get("log").error("unhandled", safeErrorFields(err));
    return c.json(body, status);
  });

  return app;
}
