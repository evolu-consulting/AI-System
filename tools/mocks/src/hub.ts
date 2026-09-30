// ADM-NFR-06 · mock Agent Hub (spec M0 §3.3, §3.4). Cổng mặc định 4020.
import { Hono } from "hono";
import {
  HUB_EFFECTIVE_OK,
  HUB_HEALTH,
  HUB_TEST_RUN_OK,
  HUB_TOKENS,
  HUB_UNAUTHORIZED,
  hubValidationFailed,
  NOT_FOUND_BODY,
} from "./fixtures";
import { isPlainObject, readJsonObject, scenarioMiddleware } from "./scenario";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function createHubMock(opts: { timeoutMs: number }): Hono {
  const app = new Hono();

  // Đăng ký trước middleware kịch bản: /health không cần token, không bao giờ chờ.
  app.get("/health", (c) => c.json(HUB_HEALTH));

  app.use(
    scenarioMiddleware({
      tokens: HUB_TOKENS,
      timeoutMs: opts.timeoutMs,
      unauthorized: (c) => c.json(HUB_UNAUTHORIZED, 401),
    }),
  );

  app.post("/internal/test-run", async (c) => {
    const body = await readJsonObject(c);
    const bad = !isPlainObject(body.command)
      ? "command"
      : !isPlainObject(body.inputs)
        ? "inputs"
        : null;
    if (bad) return c.json(hubValidationFailed(`${bad} không hợp lệ`), 400);
    return c.json(HUB_TEST_RUN_OK(body.inputs));
  });

  app.get("/agent-grants/effective/:user_id", (c) => {
    if (!UUID_RE.test(c.req.param("user_id"))) {
      return c.json(hubValidationFailed("user_id không hợp lệ"), 400);
    }
    return c.json(HUB_EFFECTIVE_OK);
  });

  app.notFound((c) => c.json(NOT_FOUND_BODY, 404));
  return app;
}
