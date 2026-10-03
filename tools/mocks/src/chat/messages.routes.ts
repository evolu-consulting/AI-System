// C1-R01, C1-R02, C1-R09, CHAT-AC-05..16, 24–28, 31 · E12–E15 gửi tin + run (plan C1 §2.4, §2.6, §3.1).
// Thứ tự kiểm: auth (Bearer) → path uuid (404) → sở hữu (404) → body (400) → `flow_id` thuộc hội thoại (404)
// → trạng thái (409 `FLOW_BUSY`). Lỗi trước khi mở stream trả JSON; sau đó là SSE.
import { UuidSchema } from "@ai/contracts";
import {
  FLOW_ID_HEADER,
  isFlowIdle,
  LAST_EVENT_ID_HEADER,
  LAST_EVENT_ID_QUERY,
  MESSAGE_ID_HEADER,
  RUN_ID_HEADER,
  SendMessageRequestSchema,
} from "@ai/contracts/chat";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ChatVars } from "./auth";
import { loadConversation, ownerOf } from "./conversations.routes";
import { chatError, parseBody } from "./http";
import type { RunEngine, RunRec } from "./runs";
import { pickScenario, type ScenarioName } from "./scenarios";
import { runStream, type StreamOptions, sseResponse } from "./sse";
import type { ChatStore, ConvRec, FlowRec } from "./store";

type Ctx = Context<ChatVars>;
export type MessageRoutesDeps = {
  store: ChatStore;
  engine: RunEngine;
  /** Mặc định toàn cục từ `/__mock/scenario` (null = `normal`). */
  fallback: () => ScenarioName | null;
  flowIdleS: number;
  stream?: StreamOptions;
};

/** spec §9 M8: header thắng query; thiếu hoặc không phải số nguyên ≥ 0 → 0 (phát lại từ đầu). */
export function readLastEventId(c: Ctx): number {
  const raw = c.req.header(LAST_EVENT_ID_HEADER) ?? c.req.query(LAST_EVENT_ID_QUERY) ?? "";
  return /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : 0;
}

function loadRun(c: Ctx, engine: RunEngine): RunRec | null {
  const id = c.req.param("id") ?? "";
  if (!UuidSchema.safeParse(id).success) return null;
  return engine.get(ownerOf(c), id);
}

type Target = { flow: FlowRec; messageId: string; idle: boolean } | { res: Response };

/** Có `flow_id` → tin vào flow đó (404 nếu khác hội thoại, 409 nếu đang chạy); không → flow mới (C1-R01). */
function placeMessage(c: Ctx, d: MessageRoutesDeps, conv: ConvRec, body: Body): Target {
  if (body.flow_id === undefined) {
    const { flow, message } = d.store.startFlow(conv, body.content);
    return { flow, messageId: message.id, idle: false };
  }
  const flow = d.store.getFlow(conv.id, body.flow_id);
  if (!flow) return { res: chatError(c, "NOT_FOUND") };
  if (flow.activeRunId !== null) return { res: chatError(c, "FLOW_BUSY") };
  const idle = isFlowIdle(new Date(flow.lastActiveAt).toISOString(), Date.now(), d.flowIdleS);
  return { flow, messageId: d.store.addUserMessage(flow, body.content).id, idle };
}
type Body = { content: string; flow_id?: string | undefined };

function registerSend(app: Hono<ChatVars>, d: MessageRoutesDeps): void {
  // E12 · trả SSE ngay (header trước `run.started`, kể cả `flow-cold`).
  app.post("/conversations/:id/messages", async (c) => {
    const conv = loadConversation(c, d.store);
    if (!conv) return chatError(c, "NOT_FOUND");
    const b = await parseBody(c, SendMessageRequestSchema);
    if (!b.ok) return chatError(c, "VALIDATION_ERROR", b.issues);
    const t = placeMessage(c, d, conv, b.data);
    if ("res" in t) return t.res;
    const scenario = pickScenario({
      content: b.data.content,
      fallback: d.fallback(),
      flowIdle: t.idle,
    });
    const run = d.engine.start({ owner: ownerOf(c), flow: t.flow, scenario });
    return sseResponse(runStream(d.engine, run, 0, d.stream), {
      [RUN_ID_HEADER]: run.id,
      [FLOW_ID_HEADER]: t.flow.id,
      [MESSAGE_ID_HEADER]: t.messageId,
    });
  });
}

function registerRuns(app: Hono<ChatVars>, d: MessageRoutesDeps): void {
  // E13 · phát lại `id > Last-Event-ID` rồi nghe tiếp (410/giữ sự kiện: B5).
  app.get("/runs/:id/events", (c) => {
    const run = loadRun(c, d.engine);
    if (!run) return chatError(c, "NOT_FOUND");
    return sseResponse(runStream(d.engine, run, readLastEventId(c), d.stream));
  });

  // E14
  app.get("/runs/:id", (c) => {
    const run = loadRun(c, d.engine);
    return run ? c.json(d.engine.toRun(run)) : chatError(c, "NOT_FOUND");
  });

  // E15 · trả ảnh chụp lúc nhận; huỷ đồng bộ; idempotent.
  app.post("/runs/:id/cancel", (c) => {
    const run = loadRun(c, d.engine);
    if (!run) return chatError(c, "NOT_FOUND");
    const snapshot = d.engine.toRun(run);
    d.engine.cancel(run.id);
    return c.json(snapshot);
  });
}

/** E12–E15. Gắn sau middleware Bearer. */
export function createMessageRoutes(d: MessageRoutesDeps): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  registerSend(app, d);
  registerRuns(app, d);
  return app;
}
