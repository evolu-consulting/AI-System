// ADM-NFR-06 · dựng app Hono (spec M0 §3.1). Factory thuần: không đọc env, để test in-process.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError, toErrorBody } from "./lib/errors";
import { logger } from "./lib/logger";
import { healthRoutes } from "./modules/health/health.routes";

export type AppConfig = { version: string; corsOrigins: string[] };
type Vars = { Variables: { requestId: string } };

const REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function createApp(cfg: AppConfig): Hono<Vars> {
  const app = new Hono<Vars>();

  // Tự viết thay `hono/request-id`: bản của Hono từ chối dấu "." mà spec cho phép.
  app.use(async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", id);
    const t0 = performance.now();
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, id);
    logger.info("request", {
      request_id: id,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round((performance.now() - t0) * 10) / 10,
    });
  });
  app.use(cors({ origin: cfg.corsOrigins, credentials: true, exposeHeaders: [REQUEST_ID_HEADER] }));

  app.route("/health", healthRoutes(cfg));

  app.notFound((c) => c.json(toErrorBody("NOT_FOUND", "Not found"), 404));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(toErrorBody(err.code, err.message, err.details), err.status);
    }
    logger.error("unhandled", {
      request_id: c.get("requestId"),
      error: err.message,
      stack: err.stack,
    });
    return c.json(toErrorBody("INTERNAL_ERROR", "Internal server error"), 500);
  });

  return app;
}
