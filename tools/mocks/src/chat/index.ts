// CHAT-AC-01..04, CHAT-AC-31 · mock Hub kênh chat (plan C1 §3.1): ghép `/auth/*`, `/__mock/*` và endpoint Hub có Bearer.
// Gắn vào `createHubMock` TRƯỚC middleware kịch bản M0 → route chat không cần token `mock-ok`.
import { type ChatPage, type Conversation, ConversationListQuerySchema } from "@ai/contracts/chat";
import { Hono } from "hono";
import type { ChatMockEnv } from "../env";
import { type ChatVars, createAuthRoutes, requireAccess } from "./auth";
import { createControlRoutes } from "./control";
import { createSessionStore } from "./sessions";

export type ChatMockOptions = Omit<ChatMockEnv, "healthVersion">;

export function createChatMock(_opts: ChatMockOptions): Hono<ChatVars> {
  const sessions = createSessionStore();
  const app = new Hono<ChatVars>();
  app.route("/", createAuthRoutes(sessions));
  app.route("/", createControlRoutes({ sessions }));

  // Mọi endpoint Hub của kênh chat (E5–E15) đi qua Bearer JWT của mock (`/x/*` của Hono khớp cả `/x`).
  const bearer = requireAccess(sessions);
  app.use("/conversations/*", bearer);
  app.use("/runs/*", bearer);

  // Khung tạm tới B3 (E5 thật: store + seed + cursor): đủ cho đối chứng 200 của K-A8/K-A9.
  app.get("/conversations", (c) => {
    if (!ConversationListQuerySchema.safeParse(c.req.query()).success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } }, 400);
    }
    return c.json({ items: [], next_cursor: null } satisfies ChatPage<Conversation>);
  });

  return app;
}
