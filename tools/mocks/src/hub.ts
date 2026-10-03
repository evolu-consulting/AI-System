// ADM-NFR-06, CHAT-AC-31 · mock Agent Hub (spec M0 §3.3, §3.4; plan C1 §3). Cổng mặc định 4020.
import { FLOW_IDLE_S, RUN_EVENTS_RETENTION_S } from "@ai/contracts/chat";
import { Hono } from "hono";
import { createChatMock } from "./chat/index";
import type { ChatMockEnv } from "./env";
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

/** `{timeoutMs}` kiểu M0 vẫn hợp lệ: phần chat lấy mặc định, `/health` giữ `version:"mock"` của M0. */
export type HubMockOptions = { timeoutMs: number } & Partial<ChatMockEnv>;

export function createHubMock(opts: HubMockOptions): Hono {
  const app = new Hono();

  // Đăng ký trước middleware kịch bản: /health không cần token, không bao giờ chờ.
  const health = { ...HUB_HEALTH, version: opts.healthVersion ?? HUB_HEALTH.version };
  app.get("/health", (c) => c.json(health));
  // Kênh chat (C1): auth JWT riêng, cũng đứng trước kịch bản M0.
  app.route("/", createChatMock(chatOptions(opts)));

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

function chatOptions(opts: HubMockOptions) {
  return {
    fast: opts.fast ?? false,
    flowIdleS: opts.flowIdleS ?? FLOW_IDLE_S,
    eventsRetentionS: opts.eventsRetentionS ?? RUN_EVENTS_RETENTION_S,
  };
}
