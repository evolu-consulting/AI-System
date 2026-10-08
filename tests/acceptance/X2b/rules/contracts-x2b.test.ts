// HUB-FR-101 · HUB-FR-103 · contract `@ai/contracts/chat` khối X2b chỉ thêm (plan §2, test-plan X2b §3 K1–K8). Nạp động
// (export X2b chưa có ⇒ `undefined` ⇒ đỏ ở expect). K8 xanh trước code (bảo toàn X2a: 8 mã lỗi, 8 sự kiện).
import { describe, expect, it } from "bun:test";
import { loadChat } from "../_modules";

const U = (n: number) => `a2bb0000-0000-4000-8000-${String(30_000 + n).padStart(12, "0")}`;
const AT = "2026-10-08T01:00:00.000Z";
const ok = (s: { safeParse?: (v: unknown) => { success: boolean } } | undefined, v: unknown) => {
  expect(typeof s?.safeParse).toBe("function");
  return s?.safeParse?.(v).success;
};
const agent = { key: "hoadon", name: { vi: "Hoá đơn", en: "Invoice" } };
const caller = { id: U(1), display_name: "Lan" };
const userMsg = {
  id: U(2),
  room_id: U(3),
  seq: 1,
  sender_type: "user",
  sender: caller,
  content: "@hoadon kiểm tra",
  client_msg_id: U(4),
  created_at: AT,
};
const agentMsg = {
  ...userMsg,
  id: U(5),
  seq: 2,
  sender_type: "agent",
  sender: { id: U(6), display_name: "Hoá đơn" },
  content: "Hoá đơn hợp lệ.",
  client_msg_id: null,
  run_id: U(7),
  flow_id: U(8),
  trigger_message_id: U(2),
  placement: "main",
  agent,
  caller,
  run_status: "finished",
  steps: { count: 1, ms: 1200 },
  flow: { message_count: 2, last_active_at: AT },
};

describe("K1–K2 · lỗi CHAT_ROOM_AGENT_ERRORS [plan §2.1, D9]", () => {
  it("HUB-FR-101 · K1 · CHAT_ROOM_AGENT_ERRORS = {NOT_RUN_CALLER: 403}; CHAT_ROOM_AGENT_ERROR_CODES khớp [X2b-R11]", async () => {
    const c = await loadChat();
    expect(c.CHAT_ROOM_AGENT_ERRORS).toEqual({ NOT_RUN_CALLER: 403 });
    expect([...(c.CHAT_ROOM_AGENT_ERROR_CODES ?? [])]).toEqual(["NOT_RUN_CALLER"]);
  });
  it("HUB-FR-101 · K2 · NOT_RUN_CALLER không nằm trong CHAT_ROOM_ERRORS / CHAT_API_ERRORS (khối riêng)", async () => {
    const c = await loadChat();
    expect(c.CHAT_ROOM_AGENT_ERRORS).toBeDefined();
    expect(Object.keys(c.CHAT_ROOM_ERRORS ?? {})).not.toContain("NOT_RUN_CALLER");
    expect(Object.keys(c.CHAT_API_ERRORS ?? {})).not.toContain("NOT_RUN_CALLER");
  });
});

describe("K3–K6 · rooms.ts [plan §2.2]", () => {
  it("HUB-FR-101 · K3 · hằng ROOM_ORCHESTRATOR_TAG, ROOM_CONTEXT_MAX=20, ROOM_THREAD_CONTEXT_MAX=50, ROOM_ACTIVE_RUNS_MAX=50, placements/statuses/wait kinds", async () => {
    const c = await loadChat();
    expect(c.ROOM_ORCHESTRATOR_TAG).toBe("orchestrator");
    expect(c.ROOM_CONTEXT_MAX).toBe(20);
    expect(c.ROOM_THREAD_CONTEXT_MAX).toBe(50);
    expect(c.ROOM_ACTIVE_RUNS_MAX).toBe(50);
    expect([...(c.ROOM_PLACEMENTS ?? [])]).toEqual(["main", "flow"]);
    expect([...(c.ROOM_RUN_STATUSES ?? [])]).toEqual(["finished", "failed", "cancelled"]);
    expect([...(c.ROOM_WAIT_KINDS ?? [])]).toEqual(["need_input", "side_effect"]);
  });

  it("HUB-FR-101 · K4 · RoomMessageSchema nhận tin agent đủ trường mới; placement/run_status lạ ⇒ fail; tin X2a vẫn hợp lệ", async () => {
    const c = await loadChat();
    expect(ok(c.RoomMessageSchema, userMsg)).toBe(true);
    expect(ok(c.RoomMessageSchema, agentMsg)).toBe(true);
    expect(ok(c.RoomMessageSchema, { ...agentMsg, ask: { kind: "side_effect" } })).toBe(true);
    expect(ok(c.RoomMessageSchema, { ...agentMsg, placement: "side" })).toBe(false);
    expect(ok(c.RoomMessageSchema, { ...agentMsg, run_status: "running" })).toBe(false);
    expect(ok(c.RoomMessageSchema, { ...agentMsg, ask: { kind: "need_input", x: 1 } })).toBe(false);
    expect(ok(c.RoomAgentRefSchema, { ...agent, id: U(9) })).toBe(false);
  });

  it("HUB-FR-101 · K5 · SendRoomMessageRequest: + flow_id?, answer_run_id? (cần flow_id); attachment_ids ⇒ fail [X2b-AC11, D16]", async () => {
    const c = await loadChat();
    const base = { content: "@hoadon kiểm tra", client_msg_id: U(10) };
    expect(ok(c.SendRoomMessageRequestSchema, base)).toBe(true);
    expect(
      ok(c.SendRoomMessageRequestSchema, { ...base, flow_id: U(8), answer_run_id: U(7) }),
    ).toBe(true);
    expect(ok(c.SendRoomMessageRequestSchema, { ...base, attachment_ids: [U(11)] })).toBe(false);
    expect(ok(c.SendRoomMessageRequestSchema, { ...base, answer_run_id: U(7) })).toBe(false);
    expect(ok(c.RoomMessageListQuerySchema, { flow_id: U(8) })).toBe(true);
  });

  it("HUB-FR-101 · K6 · RoomActiveRunSchema strict; RoomDetail.active_runs ≤ 50", async () => {
    const c = await loadChat();
    const run = {
      run_id: U(7),
      flow_id: U(8),
      trigger_message_id: U(2),
      agent: null,
      caller,
      status: "waiting",
      wait_kind: "need_input",
      started_at: AT,
    };
    expect(ok(c.RoomActiveRunSchema, run)).toBe(true);
    expect(
      ok(c.RoomActiveRunSchema, { ...run, agent, status: "running", wait_kind: undefined }),
    ).toBe(true);
    expect(ok(c.RoomActiveRunSchema, { ...run, status: "finished" })).toBe(false);
    expect(ok(c.RoomActiveRunSchema, { ...run, user_id: U(1) })).toBe(false);
  });
});

describe("K7–K8 · me-stream [plan §2.3, D10]", () => {
  const started = {
    room_id: U(3),
    run_id: U(7),
    flow_id: U(8),
    trigger_message_id: U(2),
    agent,
    caller,
  };
  it("HUB-FR-101 · K7 · ME_STREAM_RUN_EVENTS 3 sự kiện; parseMeStreamRunEvent parse đúng, JSON hỏng / lạ / khoá thừa ⇒ null [X2b-R18]", async () => {
    const c = await loadChat();
    expect([...(c.ME_STREAM_RUN_EVENTS ?? [])].sort()).toEqual([
      "room.run_finished",
      "room.run_started",
      "room.run_waiting",
    ]);
    expect(typeof c.parseMeStreamRunEvent).toBe("function");
    const p = c.parseMeStreamRunEvent ?? (() => null);
    expect(p("room.run_started", JSON.stringify(started))).not.toBeNull();
    expect(p("room.run_started", JSON.stringify({ ...started, agent: null }))).not.toBeNull();
    const waiting = {
      room_id: U(3),
      run_id: U(7),
      flow_id: U(8),
      caller_id: U(1),
      kind: "side_effect",
    };
    expect(p("room.run_waiting", JSON.stringify(waiting))).not.toBeNull();
    const fin = {
      room_id: U(3),
      run_id: U(7),
      flow_id: U(8),
      status: "cancelled",
      message_id: null,
    };
    expect(p("room.run_finished", JSON.stringify(fin))).not.toBeNull();
    expect(p("room.run_started", "{hỏng")).toBeNull();
    expect(p("room.run_exploded", JSON.stringify(started))).toBeNull();
    expect(p("room.run_waiting", JSON.stringify({ ...waiting, question: "lộ?" }))).toBeNull();
  });

  it("HUB-FR-99 · K8 · bảo toàn X2a: CHAT_ROOM_ERRORS 8 mã, ME_STREAM_EVENTS 8 sự kiện, không chứa room.run_* [D9, D10]", async () => {
    const c = await loadChat();
    expect(Object.keys(c.CHAT_ROOM_ERRORS ?? {}).length).toBe(8);
    expect([...(c.ME_STREAM_EVENTS ?? [])].length).toBe(8);
    expect([...(c.ME_STREAM_EVENTS ?? [])].some((e: string) => e.startsWith("room.run_"))).toBe(
      false,
    );
  });
});
