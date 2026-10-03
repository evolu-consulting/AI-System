// CHAT-AC-01..04, CHAT-AC-31, C1-R09 · mock Hub kênh chat (plan C1 §3.1): ghép `/auth/*`, `/__mock/*` và endpoint Hub có Bearer.
// Gắn vào `createHubMock` TRƯỚC middleware kịch bản M0 → route chat không cần token `mock-ok`.
import { Hono } from "hono";
import type { ChatMockEnv } from "../env";
import { type ChatVars, createAuthRoutes, requireAccess } from "./auth";
import { createControlRoutes } from "./control";
import { createConversationRoutes } from "./conversations.routes";
import { createMessageRoutes } from "./messages.routes";
import { RunEngine } from "./runs";
import { isScenarioName, type ScenarioName } from "./scenarios";
import { seedChat } from "./seed";
import { createSessionStore } from "./sessions";
import { ChatStore } from "./store";

export type ChatMockOptions = Omit<ChatMockEnv, "healthVersion">;

export function createChatMock(opts: ChatMockOptions): Hono<ChatVars> {
  const sessions = createSessionStore();
  const store = new ChatStore();
  const engine = new RunEngine({ store, fast: opts.fast });
  let fallback: ScenarioName | null = null;
  seedChat(store);
  const app = new Hono<ChatVars>();
  app.route("/", createAuthRoutes(sessions));
  const onReset = () => {
    engine.reset();
    store.reset();
    seedChat(store);
    fallback = null;
  };
  const setScenario = (name: string | null) => {
    if (name !== null && !isScenarioName(name)) return false;
    fallback = name;
    return true;
  };
  app.route("/", createControlRoutes({ sessions, onReset, setScenario }));

  // Mọi endpoint Hub của kênh chat (E5–E15) đi qua Bearer JWT của mock (`/x/*` của Hono khớp cả `/x`).
  const bearer = requireAccess(sessions);
  app.use("/conversations/*", bearer);
  app.use("/runs/*", bearer);
  const onDeleted = (runIds: string[]) => {
    for (const id of runIds) engine.cancel(id);
  };
  app.route("/", createConversationRoutes({ store, onDeleted }));
  app.route(
    "/",
    createMessageRoutes({ store, engine, fallback: () => fallback, flowIdleS: opts.flowIdleS }),
  );

  return app;
}
