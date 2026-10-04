// HUB-FR-40 · HUB-FR-45 · E5–E11 (C1 plan §2.4). Thứ tự kiểm: auth (401, middleware gốc) → path uuid (404) →
// sở hữu (404) → body/query (400). Parse bằng contract chat → gọi service → trả response. Không logic.
import {
  ConversationCreateRequestSchema,
  ConversationListQuerySchema,
  ConversationUpdateRequestSchema,
  FlowListQuerySchema,
  MessageListQuerySchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import { conversationService } from "./conversations.service";

export function conversationRoutes(db: Db): Hono<AuthVars> {
  const svc = conversationService(db);
  const r = new Hono<AuthVars>();

  r.get("/", async (c) =>
    c.json(await svc.list(c.var.user, parseQuery(c, ConversationListQuerySchema))),
  );

  r.post("/", async (c) => {
    const body = await parseJson(c, ConversationCreateRequestSchema);
    return c.json(await svc.create(c.var.user, body.title), 201);
  });

  r.get("/:id", async (c) => c.json(await svc.get(c.var.user, parseIdParam(c))));

  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    await svc.get(c.var.user, id);
    const body = await parseJson(c, ConversationUpdateRequestSchema);
    return c.json(await svc.rename(c.var.user, id, body.title));
  });

  r.delete("/:id", async (c) => {
    await svc.remove(c.var.user, parseIdParam(c));
    return c.body(null, 204);
  });

  r.get("/:id/flows", async (c) => {
    const id = parseIdParam(c);
    await svc.get(c.var.user, id);
    return c.json(await svc.flows(c.var.user, id, parseQuery(c, FlowListQuerySchema)));
  });

  r.get("/:id/messages", async (c) => {
    const id = parseIdParam(c);
    await svc.get(c.var.user, id);
    return c.json(await svc.messages(c.var.user, id, parseQuery(c, MessageListQuerySchema)));
  });

  return r;
}
