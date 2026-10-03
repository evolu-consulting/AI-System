// CHAT-AC-01..04, CHAT-AC-31, C1-R09 · mock Hub kênh chat (plan C1 §3.1): ghép `/auth/*`, `/__mock/*` và endpoint Hub có Bearer.
// Gắn vào `createHubMock` TRƯỚC middleware kịch bản M0 → route chat không cần token `mock-ok`.
import { Hono } from "hono";
import type { ChatMockEnv } from "../env";
import { type ChatVars, createAuthRoutes, requireAccess } from "./auth";
import { createControlRoutes } from "./control";
import { createConversationRoutes } from "./conversations.routes";
import { seedChat } from "./seed";
import { createSessionStore } from "./sessions";
import { ChatStore } from "./store";

export type ChatMockOptions = Omit<ChatMockEnv, "healthVersion">;

export function createChatMock(_opts: ChatMockOptions): Hono<ChatVars> {
  const sessions = createSessionStore();
  const store = new ChatStore();
  seedChat(store);
  const app = new Hono<ChatVars>();
  app.route("/", createAuthRoutes(sessions));
  const onReset = () => {
    store.reset();
    seedChat(store);
  };
  app.route("/", createControlRoutes({ sessions, onReset }));

  // Mọi endpoint Hub của kênh chat (E5–E15) đi qua Bearer JWT của mock (`/x/*` của Hono khớp cả `/x`).
  const bearer = requireAccess(sessions);
  app.use("/conversations/*", bearer);
  app.use("/runs/*", bearer);
  app.route("/", createConversationRoutes({ store }));

  return app;
}
