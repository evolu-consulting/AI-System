// ADM-NFR-06, ADM-FR-01 · dựng app Hono (spec M0 §3.1, plan M1 §6.1). Factory thuần: không đọc env, để test in-process.
// `deps` vắng → chỉ /health (giữ test khoá M0); có `deps` → mount /auth, /admin/*.
import type { AppEnv, Db } from "@ai/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppVars } from "./lib/auth-middleware";
import { AppError, toErrorBody } from "./lib/errors";
import type { JwtKeys } from "./lib/jwt";
import { logger } from "./lib/logger";
import { safeErrorFields } from "./lib/pg-errors";
import type { SecretKey } from "./lib/secret-crypto";
import type { TestHooks } from "./lib/test-hooks";
import { meRoutes, selfChangeHandler } from "./modules/auth/auth.me.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { featuresRoutes } from "./modules/features/features.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { secretsRoutes } from "./modules/secrets/secrets.routes";
import { tenantsRoutes } from "./modules/tenants/tenants.routes";
import { usersRoutes } from "./modules/users/users.routes";

export type AppConfig = { version: string; corsOrigins: string[] };
export type AppDeps = {
  db: Db;
  keys: JwtKeys;
  appEnv: AppEnv;
  dummyHash: string;
  now?: () => Date;
  /** Khoá mã hoá secret (M2); vắng (fixture M1) → POST/PUT /admin/secrets trả 500. */
  secretKey?: SecretKey;
  /** Điểm dừng sau khoá cho test khoá hàng (G8); chỉ dùng khi `appEnv === "test"`, khác → bỏ qua. */
  testHooks?: TestHooks;
};

const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOW_HEADERS = ["Content-Type", "Authorization", "X-Client", REQUEST_ID_HEADER];

function mountApi(app: Hono<AppVars>, deps: AppDeps): void {
  const ctx = {
    db: deps.db,
    keys: deps.keys,
    dummyHash: deps.dummyHash,
    now: deps.now ?? (() => new Date()),
  };
  const secureCookie = deps.appEnv === "production";
  const hooks = deps.appEnv === "test" ? deps.testHooks : undefined;
  app.route("/auth", authRoutes({ ...ctx, secureCookie, selfChange: selfChangeHandler(ctx) }));
  app.route("/auth", meRoutes(ctx));
  app.route("/admin/tenants", tenantsRoutes(ctx));
  app.route("/admin/users", usersRoutes(ctx));
  app.route("/admin/secrets", secretsRoutes({ ...ctx, secretKey: deps.secretKey }));
  app.route("/admin/features", featuresRoutes({ ...ctx, hooks }));
}

export function createApp(cfg: AppConfig, deps?: AppDeps): Hono<AppVars> {
  const app = new Hono<AppVars>();

  // Tự viết thay `hono/request-id`: bản của Hono từ chối dấu "." mà spec cho phép.
  // Không bao giờ log body, Authorization, Cookie, Set-Cookie (CONVENTIONS §5).
  app.use(async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", id);
    const t0 = performance.now();
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, id);
    const actor = c.get("actor") as AppVars["Variables"]["actor"] | undefined;
    logger.info("request", {
      request_id: id,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round((performance.now() - t0) * 10) / 10,
      ...(actor ? { tenant_id: actor.tenantId, user_id: actor.userId } : {}),
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

  app.route("/health", healthRoutes(cfg));
  if (deps) mountApi(app, deps);

  app.notFound((c) => c.json(toErrorBody("NOT_FOUND", "Not found"), 404));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(toErrorBody(err.code, err.message, err.details), err.status);
    }
    logger.error("unhandled", { request_id: c.get("requestId"), ...safeErrorFields(err) });
    return c.json(toErrorBody("INTERNAL_ERROR", "Internal server error"), 500);
  });

  return app;
}
