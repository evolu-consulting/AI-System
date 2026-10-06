// CHAT-AC-06, CHAT-AC-28 · reducer run: phase, cold (UC-06), content thay chữ, chống lặp id, ask → asked, CANCELLED → cancelled.
import { expect, test } from "bun:test";
import type { ChatEvent } from "@ai/contracts/chat";
import { reconnectDelay } from "./reconnect";
import {
  createAttachedState,
  createRunState,
  isRunActive,
  type RunState,
  runReducer,
} from "./reducer";

const RUN = "11111111-1111-4111-8111-111111111111";
const FLOW = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";

const started: ChatEvent = {
  id: 1,
  event: "run.started",
  data: { run_id: RUN, flow_id: FLOW, quota: { state: "warn", pct: 85 } },
};
const delta = (id: number, text: string): ChatEvent => ({ id, event: "delta", data: { text } });
const finished = (id: number, content: string): ChatEvent => ({
  id,
  event: "run.finished",
  data: { run_id: RUN, message_id: MSG, content, ms: 7800 },
});

const fresh = (over: Partial<Parameters<typeof createRunState>[0]> = {}) =>
  createRunState({
    key: "k",
    convId: "c",
    origin: "main",
    request: { content: "Xin chào" },
    ...over,
  });
const feed = (s: RunState, ...events: ChatEvent[]) => runReducer(s, { type: "events", events });

test("CHAT-AC-06 · delta ghép rồi run.finished.content THAY chữ", () => {
  let s = feed(fresh(), started, delta(2, "Chào "), delta(3, "bạn"));
  expect(s.phase).toBe("streaming");
  expect(s.text).toBe("Chào bạn");
  expect(s.quota).toEqual({ state: "warn", pct: 85 });
  s = feed(s, finished(4, "Chào bạn!"));
  expect(s.phase).toBe("finished");
  expect(s.text).toBe("Chào bạn!");
  expect(s.answerId).toBe(MSG);
  expect(s.ms).toBe(7800);
  expect(isRunActive(s)).toBe(false);
});

test("C1-R06 · sự kiện id ≤ lastEventId bị bỏ (nối lại phát trùng)", () => {
  const s = feed(fresh(), started, delta(2, "A"), delta(2, "A"), delta(1, "X"), delta(3, "B"));
  expect(s.text).toBe("AB");
  expect(s.lastEventId).toBe(3);
});

test("UC-06 · gửi vào flow nghỉ → cold tới run.started; flow mới → sending", () => {
  const now = Date.parse("2026-10-04T10:00:00Z");
  const cold = fresh({
    request: { content: "x", flowId: FLOW },
    flowLastActiveAt: "2026-10-04T09:40:00Z",
    nowMs: now,
  });
  expect(cold.phase).toBe("cold");
  const warm = fresh({
    request: { content: "x", flowId: FLOW },
    flowLastActiveAt: "2026-10-04T09:55:00Z",
    nowMs: now,
  });
  expect(warm.phase).toBe("sending");
  expect(feed(cold, started).phase).toBe("streaming");
});

test("UC-05 · ask rồi run.finished → asked", () => {
  const ask: ChatEvent = {
    id: 2,
    event: "ask",
    data: { question: "Kỳ nào?", choices: ["Q1", "Q2"] },
  };
  const s = feed(fresh(), started, ask, finished(3, ""));
  expect(s.phase).toBe("asked");
  expect(s.ask?.choices).toEqual(["Q1", "Q2"]);
});

test("UC-04 · run.failed CANCELLED → cancelled, giữ chữ; mã khác → failed", () => {
  const fail = (code: "CANCELLED" | "TIMEOUT"): ChatEvent => ({
    id: 3,
    event: "run.failed",
    data: { run_id: RUN, message_id: MSG, code, message: "m", hint: "" },
  });
  let s = runReducer(feed(fresh(), started, delta(2, "Dở")), { type: "cancelRequested" });
  expect(s.cancelling).toBe(true);
  s = feed(s, fail("CANCELLED"));
  expect(s.phase).toBe("cancelled");
  expect(s.text).toBe("Dở");
  expect(feed(fresh(), started, fail("TIMEOUT")).error?.code).toBe("TIMEOUT");
});

test("bước: step.started → running, step.finished → ok + ms", () => {
  const s = feed(
    fresh(),
    started,
    { id: 2, event: "step.started", data: { step_id: "s1", label: "Đọc dữ liệu" } },
    { id: 3, event: "step.finished", data: { step_id: "s1", status: "ok", ms: 120 } },
  );
  expect(s.steps).toEqual([{ id: "s1", label: "Đọc dữ liệu", status: "ok", ms: 120 }]);
});

test("nối lại: reconnecting → resumed về streaming; lost; đã kết thúc thì không đổi", () => {
  let s = feed(fresh(), started);
  s = runReducer(s, { type: "reconnecting", attempt: 2 });
  expect([s.phase, s.attempt]).toEqual(["reconnecting", 2]);
  expect(runReducer(s, { type: "resumed" }).phase).toBe("streaming");
  expect(runReducer(s, { type: "lost" }).phase).toBe("lost");
  expect(runReducer(fresh(), { type: "resumed" }).phase).toBe("sending");
  const done = feed(s, finished(2, "x"));
  expect(runReducer(done, { type: "reconnecting", attempt: 1 })).toBe(done);
});

test("gắn lại run đang chạy: streaming, chưa có sự kiện", () => {
  const s = createAttachedState("k2", { convId: "c", runId: RUN, flowId: FLOW, origin: "flow" });
  expect([s.phase, s.runId, s.lastEventId]).toEqual(["streaming", RUN, 0]);
});

test("C1-R06 · backoff 0,5 → 8 s, 5 lần", () => {
  expect([1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 8000, null]);
});

test("HUB-FR-91 · run.started.responder vào RunState; vắng thì không có khoá", () => {
  const withR: ChatEvent = {
    id: 1,
    event: "run.started",
    data: {
      ...(started.data as object),
      responder: { key: "dify-chatbot", name: "Chatbot (Dify)" },
    },
  } as ChatEvent;
  expect(feed(fresh(), withR).responder).toEqual({ key: "dify-chatbot", name: "Chatbot (Dify)" });
  expect("responder" in feed(fresh(), started)).toBe(false);
});
