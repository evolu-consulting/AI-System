// ADM-NFR-06 · mock Dify Service API (spec M0 §3.2, §3.4). Cổng mặc định 4010, base /v1.
import { Hono } from "hono";
import {
  DIFY_CHAT_OK,
  DIFY_PARAMETERS,
  DIFY_TOKENS,
  DIFY_UNAUTHORIZED,
  DIFY_WORKFLOW_RUN_OK,
  difyInvalidParam,
  NOT_FOUND_BODY,
} from "./fixtures";
import { isPlainObject, readJsonObject, scenarioMiddleware } from "./scenario";

/** Trường sai đầu tiên theo thứ tự cố định query → inputs → user → response_mode; hợp lệ → null. */
export function firstInvalid(body: Record<string, unknown>, withQuery: boolean): string | null {
  if (withQuery && typeof body.query !== "string") return "query is required";
  if (!isPlainObject(body.inputs)) return "inputs is required";
  if (typeof body.user !== "string") return "user is required";
  if (body.response_mode === undefined) return "response_mode is required";
  if (body.response_mode !== "blocking") return "response_mode must be blocking";
  return null;
}

export function createDifyMock(opts: { timeoutMs: number }): Hono {
  const app = new Hono();
  app.use(
    scenarioMiddleware({
      tokens: DIFY_TOKENS,
      timeoutMs: opts.timeoutMs,
      unauthorized: (c) => c.json(DIFY_UNAUTHORIZED, 401),
    }),
  );

  app.post("/v1/workflows/run", async (c) => {
    const body = await readJsonObject(c);
    const bad = firstInvalid(body, false);
    if (bad) return c.json(difyInvalidParam(bad), 400);
    return c.json(DIFY_WORKFLOW_RUN_OK(body.inputs));
  });

  app.post("/v1/chat-messages", async (c) => {
    const body = await readJsonObject(c);
    const bad = firstInvalid(body, true);
    if (bad) return c.json(difyInvalidParam(bad), 400);
    return c.json(DIFY_CHAT_OK(String(body.query)));
  });

  app.get("/v1/parameters", (c) => c.json(DIFY_PARAMETERS));

  app.notFound((c) => c.json(NOT_FOUND_BODY, 404));
  return app;
}
