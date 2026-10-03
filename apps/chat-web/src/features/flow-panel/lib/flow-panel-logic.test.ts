// CHAT-AC-14..17 · helper khung flow: ghép trang E11, run chưa có trong E11, bỏ run (bẫy F8), ngưỡng kéo sheet.
import { describe, expect, test } from "bun:test";
import type { Flow, Message } from "@ai/contracts/chat";
import { createRunState, type RunState } from "~/features/run/lib/reducer";
import {
  buildItems,
  DRAG_CLOSE_PX,
  dragShouldClose,
  orderMessages,
  runOverlay,
  shouldDismissInPanel,
} from "./flow-panel-logic";

const msg = (id: string, role: Message["role"], content = id): Message => ({
  id,
  conversation_id: "c1",
  flow_id: "f1",
  role,
  content,
  run_id: role === "assistant" ? `r-${id}` : null,
  created_at: "2026-10-04T10:00:00.000Z",
  run: null,
  ask: null,
});

const run = (over: Partial<RunState> = {}): RunState => ({
  ...createRunState({ key: "k1", convId: "c1", origin: "flow", request: { content: "Thêm ý" } }),
  flowId: "f1",
  ...over,
});

const preview = (answer: Message | null): Pick<Flow, "preview"> => ({
  preview: { question: msg("q1", "user"), answer },
});

describe("orderMessages", () => {
  test("trang mới → cũ, mỗi trang tăng → một dãy tăng", () => {
    const pages = [
      { items: [msg("m3", "user"), msg("m4", "assistant")], next_cursor: "x" },
      { items: [msg("m1", "user"), msg("m2", "assistant")], next_cursor: null },
    ];
    expect(orderMessages(pages).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(orderMessages(undefined)).toEqual([]);
  });
});

describe("runOverlay", () => {
  test("run vừa gửi: hiện câu hỏi + câu trả lời đang chạy", () => {
    expect(runOverlay(run(), new Set())).toEqual({ question: "Thêm ý", answer: true });
  });
  test("E11 đã có cả hai → không vẽ thêm", () => {
    const r = run({ messageId: "m3", answerId: "m4", phase: "finished" });
    expect(runOverlay(r, new Set(["m3", "m4"]))).toEqual({ question: null, answer: false });
  });
  test("run gắn lại (không biết nội dung) → chỉ câu trả lời", () => {
    expect(runOverlay(run({ request: { content: "" } }), new Set()).question).toBeNull();
    expect(runOverlay(undefined, new Set())).toEqual({ question: null, answer: false });
  });
});

describe("shouldDismissInPanel", () => {
  const ids = new Set(["m4"]);
  test("run trong flow đã xong + E11 có câu trả lời → bỏ", () => {
    expect(
      shouldDismissInPanel(
        run({ phase: "finished", answerId: "m4" }),
        ids,
        preview(msg("a1", "assistant")),
      ),
    ).toBe(true);
  });
  test("chưa xong / E11 chưa có → giữ", () => {
    expect(
      shouldDismissInPanel(
        run({ phase: "streaming", answerId: null }),
        ids,
        preview(msg("a1", "assistant")),
      ),
    ).toBe(false);
    expect(
      shouldDismissInPanel(
        run({ phase: "finished", answerId: "m9" }),
        ids,
        preview(msg("a1", "assistant")),
      ),
    ).toBe(false);
  });
  test("câu trả lời đầu mà E10 chưa có → để khối flow bỏ", () => {
    expect(
      shouldDismissInPanel(run({ phase: "finished", answerId: "m4" }), ids, preview(null)),
    ).toBe(false);
  });
});

describe("buildItems", () => {
  test("câu trả lời mang câu hỏi trước làm ngữ cảnh, chip vô hiệu khi có tin sau", () => {
    const items = buildItems(
      [
        msg("m1", "user", "Hỏi 1"),
        msg("m2", "assistant"),
        msg("m3", "user", "Hỏi 2"),
        msg("m4", "assistant"),
      ],
      { convId: "c1", flowId: "f1" },
      false,
    );
    expect(items.map((i) => i.kind)).toEqual(["question", "answer", "question", "answer"]);
    const [, a1, , a2] = items;
    if (a1?.kind !== "answer" || a2?.kind !== "answer") throw new Error("kind");
    expect(a1.answer.context).toEqual({
      convId: "c1",
      flowId: "f1",
      content: "Hỏi 1",
      origin: "flow",
    });
    expect(a1.answer.askAnswered).toBe(true);
    expect(a2.answer.askAnswered).toBe(false);
  });
});

test("kéo sheet: > 120px mới đóng", () => {
  expect(dragShouldClose(DRAG_CLOSE_PX)).toBe(false);
  expect(dragShouldClose(DRAG_CLOSE_PX + 1)).toBe(true);
});
