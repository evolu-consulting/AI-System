import { describe, expect, test } from "bun:test";
import {
  type ChatEvent,
  ChatEventSchema,
  createSseParser,
  deriveTitle,
  encodeSseEvent,
  foldVi,
  isFlowIdle,
  isNewEvent,
  matchesQuery,
  type RawSseEvent,
  SSE_PING_FRAME,
  toChatEvent,
} from "./index";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const started: ChatEvent = {
  id: 1,
  event: "run.started",
  data: { run_id: U1, flow_id: U2, quota: { state: "ok", pct: 12 } },
};
const finished: ChatEvent = {
  id: 3,
  event: "run.finished",
  data: { run_id: U1, message_id: U2, content: "Xin chào\nbạn", ms: 7800 },
};

describe("deriveTitle", () => {
  test("bỏ tiền tố #scn, gộp khoảng trắng", () => {
    expect(deriveTitle("#scn:slow   Hoá  đơn\n\ttháng 9 ")).toBe("Hoá đơn tháng 9");
  });
  test("cắt 40 code point + …, không cắt đôi surrogate", () => {
    expect(deriveTitle("a".repeat(41))).toBe(`${"a".repeat(40)}…`);
    expect(deriveTitle("a".repeat(40))).toBe("a".repeat(40));
    const emoji = "😀".repeat(41);
    expect(deriveTitle(emoji)).toBe(`${"😀".repeat(40)}…`);
  });
  test("rỗng → …", () => {
    expect(deriveTitle("   ")).toBe("…");
    expect(deriveTitle("#scn:normal")).toBe("…");
  });
});

describe("foldVi / matchesQuery", () => {
  test("bỏ dấu, đ → d, lower", () => {
    expect(foldVi("Hoá Đơn ĐIỆN")).toBe("hoa don dien");
  });
  test("khớp không dấu, q trống → true", () => {
    expect(matchesQuery("Hoá đơn tháng 9", "hoa don")).toBe(true);
    expect(matchesQuery("Hoá đơn", "  HOÁ ")).toBe(true);
    expect(matchesQuery("Hoá đơn", "lương")).toBe(false);
    expect(matchesQuery("x", undefined)).toBe(true);
    expect(matchesQuery("x", "   ")).toBe(true);
  });
});

describe("isFlowIdle / isNewEvent", () => {
  test("biên 600 s", () => {
    const at = "2026-10-04T08:00:00.000Z";
    const t0 = Date.parse(at);
    expect(isFlowIdle(at, t0 + 599_999)).toBe(false);
    expect(isFlowIdle(at, t0 + 600_000)).toBe(true);
    expect(isFlowIdle(at, t0 + 10_000, 10)).toBe(true);
  });
  test("id > lastId", () => {
    expect(isNewEvent(3, 2)).toBe(true);
    expect(isNewEvent(2, 2)).toBe(false);
  });
});

describe("SSE parser", () => {
  function collect(chunks: string[]): RawSseEvent[] {
    const out: RawSseEvent[] = [];
    const feed = createSseParser((e) => out.push(e));
    for (const c of chunks) feed(c);
    return out;
  }

  test("encode → parse → toChatEvent khứ hồi, bỏ ping", () => {
    const wire = encodeSseEvent(started) + SSE_PING_FRAME + encodeSseEvent(finished);
    const raws = collect([wire]);
    expect(raws.map(toChatEvent)).toEqual([started, finished]);
  });

  test("chunk cắt giữa dòng và giữa \\r\\n", () => {
    const wire = encodeSseEvent(started).replaceAll("\n", "\r\n");
    const chunks = Array.from(wire);
    expect(collect(chunks).map(toChatEvent)).toEqual([started]);
  });

  test("nhiều dòng data nối \\n; khung không data không phát", () => {
    const raws = collect(["event: x\ndata: a\ndata:b\n\nevent: y\n\n"]);
    expect(raws).toEqual([{ id: null, event: "x", data: "a\nb" }]);
  });

  test("toChatEvent ném khi thừa trường hoặc JSON hỏng", () => {
    const extra = { ...started.data, agent: "consultant" };
    const raw = { id: "1", event: "run.started", data: JSON.stringify(extra) };
    expect(() => toChatEvent(raw)).toThrow();
    expect(() => toChatEvent({ ...raw, data: "{" })).toThrow(SyntaxError);
    expect(() => toChatEvent({ id: null, event: "delta", data: '{"text":"a"}' })).toThrow();
  });

  test("ChatEventSchema: event lạ là lỗi", () => {
    expect(ChatEventSchema.safeParse({ id: 1, event: "usage", data: {} }).success).toBe(false);
    expect(ChatEventSchema.safeParse({ id: 2, event: "delta", data: { text: "" } }).success).toBe(
      false,
    );
  });
});
