// CHAT-AC-05..07, CHAT-AC-20 · helper luồng chính.
import { describe, expect, test } from "bun:test";
import type { Message } from "@ai/contracts/chat";
import { createRunState, type RunState } from "~/features/run/lib/reducer";
import {
  answerFromMessage,
  answerFromRun,
  extraMessages,
  isNearBottom,
  pendingRunKeys,
  relativeTime,
  shouldDismiss,
} from "./thread-logic";

const run = (over: Partial<RunState> = {}): RunState => ({
  ...createRunState({ key: "k1", convId: "c1", origin: "main", request: { content: "Hỏi" } }),
  ...over,
});

const msg = (over: Partial<Message> = {}): Message => ({
  id: "m2",
  conversation_id: "c1",
  flow_id: "f1",
  role: "assistant",
  content: "Trả lời",
  run_id: "r1",
  created_at: "2026-10-04T10:00:00.000Z",
  run: null,
  ask: null,
  ...over,
});

describe("autoscroll", () => {
  test("≤ 80px tính là ở đáy", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 520, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 519, clientHeight: 400 })).toBe(false);
  });
});

describe("footer", () => {
  test("+N = message_count − 2, không âm", () => {
    expect(extraMessages({ message_count: 4 })).toBe(2);
    expect(extraMessages({ message_count: 1 })).toBe(0);
  });
  test("thời gian tương đối theo locale", () => {
    const now = Date.parse("2026-10-04T10:02:00.000Z");
    expect(relativeTime("2026-10-04T10:00:00.000Z", now, "vi")).toBe("2 phút trước");
    expect(relativeTime("2026-10-04T10:00:00.000Z", now, "en")).toBe("2 minutes ago");
    expect(relativeTime("2026-10-04T08:00:00.000Z", now, "en")).toBe("2 hours ago");
  });
});

describe("run ↔ flow", () => {
  test("khối tạm: run ô chính của hội thoại mà flow chưa có trong E10", () => {
    const runs = [
      run({ key: "a" }),
      run({ key: "b", flowId: "f1" }),
      run({ key: "c", flowId: "f9" }),
      run({ key: "d", origin: "flow", flowId: "f9" }),
      run({ key: "e", convId: "c2" }),
    ];
    expect(pendingRunKeys(runs, "c1", new Set(["f1"]))).toBe("a,c");
    expect(pendingRunKeys([], "c1", new Set())).toBe("");
  });
  test("dismiss khi run xong và preview đã chứa câu trả lời", () => {
    const flow = { preview: { question: msg({ id: "m1", role: "user" }), answer: msg() } };
    expect(shouldDismiss(run({ phase: "finished", answerId: "m2" }), flow)).toBe(true);
    expect(shouldDismiss(run({ phase: "streaming", answerId: null }), flow)).toBe(false);
    expect(shouldDismiss(run({ phase: "finished", answerId: "m3" }), flow)).toBe(false);
  });
});

describe("AnswerView", () => {
  test("run đang chờ / stream / lỗi / dừng", () => {
    expect(answerFromRun(run()).waiting).toBe(true);
    expect(answerFromRun(run({ phase: "streaming", text: "Chào" }))).toMatchObject({
      streaming: true,
      waiting: false,
    });
    const err = { code: "TIMEOUT" as const, message: "x", hint: "" };
    expect(answerFromRun(run({ phase: "failed", runId: "r1", error: err })).error).toEqual({
      code: "TIMEOUT",
      runId: "r1",
    });
    expect(answerFromRun(run({ phase: "cancelled" })).cancelled).toBe(true);
  });
  test("tin đã lưu có run lỗi", () => {
    const error = { code: "TIMEOUT" as const, message: "x", hint: "" };
    const m = msg({ run: { id: "r1", status: "failed", ms: 1, steps: [], error } });
    expect(answerFromMessage(m)).toMatchObject({ streaming: false, error: { code: "TIMEOUT" } });
  });
});
