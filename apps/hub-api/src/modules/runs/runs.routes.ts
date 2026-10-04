// HUB-FR-41 · HUB-FR-42 · E12 `POST /conversations/:id/messages`, E13 `GET /runs/:id/events`, E14 `GET /runs/:id`
// (C1 plan §2.4). Thứ tự kiểm: auth (401, middleware gốc) → path uuid (404) → sở hữu (404) → body (400) → 409/410.
// Lỗi trước khi mở stream trả JSON. Parse bằng contract chat → gọi service → trả response. Không logic.
import {
  FLOW_ID_HEADER,
  LAST_EVENT_ID_HEADER,
  LAST_EVENT_ID_QUERY,
  MESSAGE_ID_HEADER,
  RUN_ID_HEADER,
  SendMessageRequestSchema,
  SSE_CONTENT_TYPE,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseIdParam, parseJson } from "../../lib/http";
import type { ConversationService } from "../conversations/conversations.service";
import { parseLastEventId } from "./runs.rules";
import type { RunService } from "./runs.service";

/** Header chống đệm cho SSE (nginx `X-Accel-Buffering`). */
const SSE_HEADERS = {
  "Content-Type": SSE_CONTENT_TYPE,
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
} as const;

/** E12 · mount dưới `/conversations` (cạnh route E5–E11). Kiểm sở hữu hội thoại trước khi parse body (404 trước 400). */
export function sendMessageRoutes(conversations: ConversationService, runs: RunService) {
  const r = new Hono<AuthVars>();
  r.post("/:id/messages", async (c) => {
    const id = parseIdParam(c);
    await conversations.get(c.var.user, id);
    const body = await parseJson(c, SendMessageRequestSchema);
    const s = await runs.start(c.var.user, id, body);
    return new Response(s.stream, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        [RUN_ID_HEADER]: s.runId,
        [FLOW_ID_HEADER]: s.flowId,
        [MESSAGE_ID_HEADER]: s.messageId,
      },
    });
  });
  return r;
}

/** E13, E14 · mount ở `/runs`. E15 (huỷ) thuộc B9. */
export function runRoutes(runs: RunService) {
  const r = new Hono<AuthVars>();
  r.get("/:id", async (c) => c.json(await runs.get(c.var.user, parseIdParam(c))));
  r.get("/:id/events", async (c) => {
    const id = parseIdParam(c);
    const after = parseLastEventId(
      c.req.header(LAST_EVENT_ID_HEADER),
      c.req.query(LAST_EVENT_ID_QUERY),
    );
    const stream = await runs.events(c.var.user, id, after);
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  });
  return r;
}
