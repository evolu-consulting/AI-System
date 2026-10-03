// C1-R09, CHAT-AC-05, 09, 18–23, 31 · E5–E11 hội thoại / flow / đọc tin (plan C1 §2.4, §2.6).
// Thứ tự kiểm: auth (middleware Bearer) → path uuid (404) → sở hữu (404) → body/query (400).
// Id của user/tenant khác, đã xoá, hay không phải uuid đều 404 `NOT_FOUND` như nhau (không 403, không lộ dữ liệu).
import { UuidSchema } from "@ai/contracts";
import {
  ConversationCreateRequestSchema,
  ConversationListQuerySchema,
  ConversationUpdateRequestSchema,
  FlowListQuerySchema,
  MessageListQuerySchema,
} from "@ai/contracts/chat";
import type { Context } from "hono";
import { Hono } from "hono";
import type { z } from "zod";
import type { ChatVars } from "./auth";
import { decodeCursor, type PageKey, paginate } from "./cursor";
import { chatError, parseBody, parseWith } from "./http";
import type { ChatStore, ConvRec, Owner } from "./store";

type Ctx = Context<ChatVars>;
export type ConversationRoutesDeps = {
  store: ChatStore;
  /** Gọi sau khi xoá mềm, với id các run đang chạy của hội thoại (B4 huỷ run). */
  onDeleted?: (activeRunIds: string[]) => void;
};

export function ownerOf(c: Ctx): Owner {
  const { sub, tid } = c.get("claims");
  return { userId: sub, tenantId: tid };
}

/** Hội thoại của `:id` thuộc người gọi, hoặc null (→ 404). Dùng chung cho E12 (B4). */
export function loadConversation(c: Ctx, store: ChatStore): ConvRec | null {
  const id = c.req.param("id") ?? "";
  if (!UuidSchema.safeParse(id).success) return null;
  return store.getConversation(ownerOf(c), id);
}

type Query<T> = { ok: true; data: T; after: PageKey | undefined } | { ok: false; res: Response };

/** Query strict theo schema + giải mã `cursor`; lỗi → 400 `VALIDATION_ERROR`. */
function readQuery<T extends { cursor?: string | undefined }>(
  c: Ctx,
  schema: z.ZodType<T>,
): Query<T> {
  const r = parseWith(schema, c.req.query());
  if (!r.ok) return { ok: false, res: chatError(c, "VALIDATION_ERROR", r.issues) };
  if (r.data.cursor === undefined) return { ok: true, data: r.data, after: undefined };
  const after = decodeCursor(r.data.cursor);
  if (after) return { ok: true, data: r.data, after };
  const issue = { path: ["cursor"], code: "custom", message: "Invalid cursor" };
  return { ok: false, res: chatError(c, "VALIDATION_ERROR", [issue]) };
}

function registerCollection(app: Hono<ChatVars>, store: ChatStore): void {
  // E5 · sắp `updated_at` giảm, hoà → `id` giảm; `q` không dấu.
  app.get("/conversations", (c) => {
    const q = readQuery(c, ConversationListQuerySchema);
    if (!q.ok) return q.res;
    const all = store.listConversations(ownerOf(c), q.data.q);
    const key = (r: ConvRec): PageKey => [r.updatedAt, r.id];
    const page = paginate(all, key, { after: q.after, limit: q.data.limit, dir: "desc" });
    return c.json({
      items: page.items.map((r) => store.toConversation(r)),
      next_cursor: page.next,
    });
  });

  // E6
  app.post("/conversations", async (c) => {
    const b = await parseBody(c, ConversationCreateRequestSchema);
    if (!b.ok) return chatError(c, "VALIDATION_ERROR", b.issues);
    const conv = store.createConversation(ownerOf(c), b.data.title);
    return c.json(store.toConversation(conv), 201);
  });
}

function registerItem(app: Hono<ChatVars>, d: ConversationRoutesDeps): void {
  const { store } = d;
  // E7
  app.get("/conversations/:id", (c) => {
    const conv = loadConversation(c, store);
    return conv ? c.json(store.toConversation(conv)) : chatError(c, "NOT_FOUND");
  });

  // E8 · đổi tên hội thoại, không đổi tiêu đề flow.
  app.patch("/conversations/:id", async (c) => {
    const conv = loadConversation(c, store);
    if (!conv) return chatError(c, "NOT_FOUND");
    const b = await parseBody(c, ConversationUpdateRequestSchema);
    if (!b.ok) return chatError(c, "VALIDATION_ERROR", b.issues);
    store.renameConversation(conv, b.data.title);
    return c.json(store.toConversation(conv));
  });

  // E9 · xoá mềm.
  app.delete("/conversations/:id", (c) => {
    const conv = loadConversation(c, store);
    if (!conv) return chatError(c, "NOT_FOUND");
    // Không viết `d.onDeleted?.(store.deleteConversation(…))`: `?.()` bỏ qua cả việc tính đối số.
    const running = store.deleteConversation(conv);
    d.onDeleted?.(running);
    return c.body(null, 204);
  });
}

function registerChildren(app: Hono<ChatVars>, store: ChatStore): void {
  // E10 · flow sắp `created_at` tăng; `next_cursor` = trang sau.
  app.get("/conversations/:id/flows", (c) => {
    const conv = loadConversation(c, store);
    if (!conv) return chatError(c, "NOT_FOUND");
    const q = readQuery(c, FlowListQuerySchema);
    if (!q.ok) return q.res;
    const key = (f: { createdAt: number; id: string }): PageKey => [f.createdAt, f.id];
    const opts = { after: q.after, limit: q.data.limit, dir: "asc" } as const;
    const page = paginate(store.flowsOf(conv.id), key, opts);
    return c.json({ items: page.items.map((f) => store.toFlow(f)), next_cursor: page.next });
  });

  // E11 · trang đầu = `limit` tin mới nhất, `items` tăng dần; `next_cursor` = trang cũ hơn.
  app.get("/conversations/:id/messages", (c) => {
    const conv = loadConversation(c, store);
    if (!conv) return chatError(c, "NOT_FOUND");
    const q = readQuery(c, MessageListQuerySchema);
    if (!q.ok) return q.res;
    const flowId = q.data.flow_id;
    if (flowId !== undefined && !store.getFlow(conv.id, flowId)) return chatError(c, "NOT_FOUND");
    const newestFirst = store.messagesOf(conv.id, flowId).reverse();
    const key = (r: { seq: number; message: { id: string } }): PageKey => [r.seq, r.message.id];
    const opts = { after: q.after, limit: q.data.limit, dir: "desc" } as const;
    const page = paginate(newestFirst, key, opts);
    const items = page.items.map((r) => r.message).reverse();
    return c.json({ items, next_cursor: page.next });
  });
}

/** E5–E11. Gắn sau middleware Bearer (`c.get("claims")` đã có). */
export function createConversationRoutes(d: ConversationRoutesDeps): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  registerCollection(app, d.store);
  registerItem(app, d);
  registerChildren(app, d.store);
  return app;
}
