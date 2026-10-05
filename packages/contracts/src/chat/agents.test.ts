// HUB-FR-91, HUB-FR-94 · phần H2b của contract chat (plan §2.1): chỉ thêm, tin/sự kiện cũ parse như trước.
import { describe, expect, test } from "bun:test";
import {
  AGENT_MENU_MAX,
  AgentMenuItemSchema,
  AgentMenuResponseSchema,
  AgentNotFoundDetailsSchema,
  CHAT_API_ERRORS,
  CHAT_COMMAND_ERRORS,
  CHAT_ROUTING_ERROR_CODES,
  CHAT_ROUTING_ERRORS,
  ChatEventSchema,
  MessageSchema,
  RESPONDER_NAME_MAX,
  RETRY_AFTER_HEADER,
  ResponderSchema,
  RunStartedDataSchema,
  TOO_MANY_RUNS_RETRY_AFTER_S,
} from "./index";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const T = "2026-10-04T08:00:00.000Z";
const item = {
  key: "hoadon",
  name: { vi: "Hoá đơn", en: "Invoices" },
  description: "Tra cứu và đối chiếu hoá đơn đầu vào",
};
const responder = { key: "hoadon", name: "Hoá đơn" };
const msg = (role: "user" | "assistant") => ({
  id: U1,
  conversation_id: U2,
  flow_id: U3,
  role,
  content: "xin chào",
  run_id: role === "user" ? null : U1,
  created_at: T,
  run: null,
  ask: null,
});
const started = { run_id: U1, flow_id: U2, quota: { state: "ok" as const, pct: 0 } };

describe("chat agents (H2b)", () => {
  test("AgentMenuItem: key theo mẫu agent, name vi+en 1–100, description 20–400, strict", () => {
    expect(AgentMenuItemSchema.parse(item)).toEqual(item);
    expect(AgentMenuItemSchema.safeParse({ ...item, key: "Hoadon" }).success).toBe(false);
    expect(AgentMenuItemSchema.safeParse({ ...item, key: "h" }).success).toBe(false);
    expect(AgentMenuItemSchema.safeParse({ ...item, name: { vi: "x" } }).success).toBe(false);
    expect(AgentMenuItemSchema.safeParse({ ...item, description: "ngắn" }).success).toBe(false);
    const long = "a".repeat(401);
    expect(AgentMenuItemSchema.safeParse({ ...item, description: long }).success).toBe(false);
    expect(AgentMenuItemSchema.safeParse({ ...item, id: U1 }).success).toBe(false);
  });

  test("AgentMenuResponse: ≤ 500 mục", () => {
    expect(AgentMenuResponseSchema.parse({ items: [] })).toEqual({ items: [] });
    const many = Array.from({ length: AGENT_MENU_MAX + 1 }, () => item);
    expect(AgentMenuResponseSchema.safeParse({ items: many }).success).toBe(false);
  });

  test("Responder: key + name 1–100, strict", () => {
    expect(ResponderSchema.parse(responder)).toEqual(responder);
    const name = "a".repeat(RESPONDER_NAME_MAX + 1);
    expect(ResponderSchema.safeParse({ ...responder, name }).success).toBe(false);
    expect(ResponderSchema.safeParse({ ...responder, name: "" }).success).toBe(false);
    expect(ResponderSchema.safeParse({ ...responder, agent: "x" }).success).toBe(false);
  });

  test("Message: responder tuỳ chọn ở assistant, vắng giữ hình cũ, cấm ở user và null", () => {
    expect(MessageSchema.parse(msg("assistant"))).toEqual(msg("assistant"));
    const withR = { ...msg("assistant"), responder };
    expect(MessageSchema.parse(withR)).toEqual(withR);
    expect(MessageSchema.safeParse({ ...msg("user"), responder }).success).toBe(false);
    expect(MessageSchema.safeParse({ ...msg("assistant"), responder: null }).success).toBe(false);
  });

  test("run.started: responder tuỳ chọn", () => {
    expect(RunStartedDataSchema.parse(started)).toEqual(started);
    const ev = { id: 1, event: "run.started" as const, data: { ...started, responder } };
    expect(ChatEventSchema.parse(ev)).toEqual(ev);
    expect(RunStartedDataSchema.safeParse({ ...started, responder: null }).success).toBe(false);
  });

  test("CHAT_ROUTING_ERRORS riêng, hằng cũ không đổi", () => {
    expect(CHAT_ROUTING_ERRORS).toEqual({ AGENT_NOT_FOUND: 404, TOO_MANY_RUNS: 429 });
    expect(CHAT_ROUTING_ERROR_CODES).toEqual(["AGENT_NOT_FOUND", "TOO_MANY_RUNS"]);
    expect(Object.keys(CHAT_API_ERRORS)).toHaveLength(6);
    expect(CHAT_COMMAND_ERRORS).toEqual({ CMD_NOT_FOUND: 404, CMD_MISSING_ARG: 422 });
    expect(RETRY_AFTER_HEADER).toBe("Retry-After");
    expect(TOO_MANY_RUNS_RETRY_AFTER_S).toBe(5);
  });

  test("AgentNotFoundDetails: suggestions ≤ 3, strict", () => {
    expect(AgentNotFoundDetailsSchema.parse({ suggestions: ["hoadon"] })).toEqual({
      suggestions: ["hoadon"],
    });
    const four = { suggestions: ["a", "b", "c", "d"] };
    expect(AgentNotFoundDetailsSchema.safeParse(four).success).toBe(false);
    expect(AgentNotFoundDetailsSchema.safeParse({ suggestions: [], x: 1 }).success).toBe(false);
  });
});
