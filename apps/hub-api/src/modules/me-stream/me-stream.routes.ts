// HUB-FR-99 · X2a-AC12 · `GET /me/stream` (X2a plan §7). 401 do middleware gốc (`/me` trong `PROTECTED_PREFIXES`) — trả JSON
// trước khi mở stream. `Last-Event-ID` CHỈ đọc từ header (không query, không token trên URL). Header SSE như `runs.routes`.
import { SSE_CONTENT_TYPE } from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { type MeStreamDeps, meEventStream, resumePlan } from "./me-stream.session";

const SSE_HEADERS = {
  "Content-Type": SSE_CONTENT_TYPE,
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
} as const;

export function meStreamRoutes(d: MeStreamDeps): Hono<AuthVars> {
  const r = new Hono<AuthVars>();

  r.get("/stream", async (c) => {
    const user = c.var.user;
    const config = c.var.config;
    const plan = await resumePlan(d.reader, user.userId, c.req.header("last-event-id"));
    const usable = async () => (await config?.accountUsable(user.tenantId, user.userId)) === true;
    return new Response(meEventStream(d, { user, plan, usable }), {
      status: 200,
      headers: SSE_HEADERS,
    });
  });

  return r;
}
