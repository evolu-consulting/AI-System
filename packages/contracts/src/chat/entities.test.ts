import { describe, expect, test } from "bun:test";
import {
  CHAT_API_ERRORS,
  CHAT_CONTENT_MAX,
  ChatPageSchema,
  ConversationListQuerySchema,
  ConversationSchema,
  FlowSchema,
  MessageListQuerySchema,
  MessageSchema,
  RunSchema,
  RunSummarySchema,
  SendMessageRequestSchema,
} from "./index";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const T = "2026-10-04T08:00:00.000Z";

const userMsg = {
  id: U1,
  conversation_id: U2,
  flow_id: U3,
  role: "user",
  content: "#scn:normal Xin chào",
  run_id: null,
  created_at: T,
  run: null,
  ask: null,
} as const;

const assistantMsg = {
  ...userMsg,
  id: U2,
  role: "assistant",
  content: "",
  run_id: U3,
  run: { id: U3, status: "finished", ms: 7800, steps: [], error: null },
  ask: { question: "Chọn?", choices: ["A", "B"] },
} as const;

describe("chat entities", () => {
  test("Conversation strict: thừa trường là lỗi", () => {
    const c = { id: U1, title: "Hoá đơn", created_at: T, updated_at: T, flow_count: 0 };
    expect(ConversationSchema.parse(c)).toEqual(c);
    expect(ConversationSchema.safeParse({ ...c, agent: "x" }).success).toBe(false);
  });

  test("Message user: content ≥ 1, run/ask null", () => {
    expect(MessageSchema.safeParse(userMsg).success).toBe(true);
    expect(MessageSchema.safeParse({ ...userMsg, content: "" }).success).toBe(false);
    expect(MessageSchema.safeParse({ ...userMsg, ask: assistantMsg.ask }).success).toBe(false);
    const long = "a".repeat(CHAT_CONTENT_MAX + 1);
    expect(MessageSchema.safeParse({ ...userMsg, content: long }).success).toBe(false);
  });

  test("Message assistant: content rỗng được, có run + ask", () => {
    expect(MessageSchema.safeParse(assistantMsg).success).toBe(true);
  });

  test("RunSummary: error khác null ⇔ failed/cancelled", () => {
    const err = { code: "CANCELLED", message: "Đã dừng", hint: "" };
    const base = { id: U1, ms: 1, steps: [] };
    expect(RunSummarySchema.safeParse({ ...base, status: "cancelled", error: err }).success).toBe(
      true,
    );
    expect(RunSummarySchema.safeParse({ ...base, status: "failed", error: null }).success).toBe(
      false,
    );
    expect(RunSummarySchema.safeParse({ ...base, status: "finished", error: err }).success).toBe(
      false,
    );
    const bad = { ...err, code: "PROVIDER_DOWN" };
    expect(RunSummarySchema.safeParse({ ...base, status: "failed", error: bad }).success).toBe(
      false,
    );
  });
});

describe("chat entities · flow/run/page", () => {
  test("Flow: preview answer null được, message_count ≥ 1", () => {
    const f = {
      id: U3,
      conversation_id: U2,
      title: "Xin chào",
      created_at: T,
      last_active_at: T,
      message_count: 1,
      active_run_id: U1,
      preview: { question: userMsg, answer: null },
    };
    expect(FlowSchema.safeParse(f).success).toBe(true);
    expect(FlowSchema.safeParse({ ...f, message_count: 0 }).success).toBe(false);
  });

  test("Run: status running, finished_at null", () => {
    const r = {
      id: U1,
      conversation_id: U2,
      flow_id: U3,
      status: "running",
      started_at: T,
      finished_at: null,
      last_event_id: 0,
      error: null,
    };
    expect(RunSchema.safeParse(r).success).toBe(true);
    expect(RunSchema.safeParse({ ...r, status: "queued" }).success).toBe(false);
  });

  test("ChatPage: next_cursor null hoặc 1–200", () => {
    const page = ChatPageSchema(ConversationSchema);
    expect(page.safeParse({ items: [], next_cursor: null }).success).toBe(true);
    expect(page.safeParse({ items: [], next_cursor: "" }).success).toBe(false);
    expect(page.safeParse({ items: [], next_cursor: null, total: 0 }).success).toBe(false);
  });
});

describe("chat requests", () => {
  test("ConversationListQuery: q rỗng → bỏ, limit mặc định 50, coerce", () => {
    expect(ConversationListQuerySchema.parse({ q: "  " })).toEqual({ q: undefined, limit: 50 });
    expect(ConversationListQuerySchema.parse({ limit: "10" }).limit).toBe(10);
    expect(ConversationListQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(ConversationListQuerySchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  });

  test("MessageListQuery: flow_id phải uuid", () => {
    expect(MessageListQuerySchema.safeParse({ flow_id: "abc" }).success).toBe(false);
    expect(MessageListQuerySchema.parse({ flow_id: U1 }).flow_id).toBe(U1);
  });

  test("SendMessageRequest: trim, 1–16000", () => {
    expect(SendMessageRequestSchema.parse({ content: "  hi  " })).toEqual({ content: "hi" });
    expect(SendMessageRequestSchema.safeParse({ content: "   " }).success).toBe(false);
    const max = "a".repeat(CHAT_CONTENT_MAX);
    expect(SendMessageRequestSchema.safeParse({ content: max }).success).toBe(true);
    expect(SendMessageRequestSchema.safeParse({ content: `${max}a` }).success).toBe(false);
  });

  test("CHAT_API_ERRORS khớp plan §2.4", () => {
    expect(CHAT_API_ERRORS).toEqual({
      VALIDATION_ERROR: 400,
      AUTH_EXPIRED: 401,
      NOT_FOUND: 404,
      FLOW_BUSY: 409,
      EVENTS_EXPIRED: 410,
      INTERNAL_ERROR: 500,
    });
  });
});
