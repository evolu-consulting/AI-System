// CHAT-AC-05, 16, 23, 28, 30, 31, 33 · hàm thuần của @ai/contracts/chat (test-plan C1 §5, U-1..U-8).
import { describe, expect, it } from "bun:test";
import {
  type ChatEvent,
  createSseParser,
  deriveTitle,
  encodeSseEvent,
  foldVi,
  isFlowIdle,
  isNewEvent,
  matchesQuery,
  type RawSseEvent,
  toChatEvent,
} from "@ai/contracts/chat";

const RUN = "11111111-1111-4111-8111-111111111111";
const FLOW = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";

describe("deriveTitle", () => {
  it("CHAT-AC-05 · bỏ tiền tố #scn:steps và khoảng trắng sau nó [U-1]", () => {
    expect(deriveTitle("#scn:steps Hoá đơn tháng 9")).toBe("Hoá đơn tháng 9");
    expect(deriveTitle("  #scn:steps   Hoá đơn")).toBe("Hoá đơn");
  });
  it("CHAT-AC-05 · gộp khoảng trắng và xuống dòng thành một dấu cách [U-1]", () => {
    expect(deriveTitle("a  b\n\n c\t d")).toBe("a b c d");
  });
  it("CHAT-AC-31 · đúng 40 code point không thêm … [U-1]", () => {
    const s = "a".repeat(40);
    expect(deriveTitle(s)).toBe(s);
  });
  it("CHAT-AC-31 · 41 code point cắt còn 40 rồi thêm … [U-1]", () => {
    expect(deriveTitle("a".repeat(41))).toBe(`${"a".repeat(40)}…`);
  });
  it("CHAT-AC-31 · emoji (cặp thay thế) không bị cắt đôi [U-1]", () => {
    const out = deriveTitle("😀".repeat(41));
    expect(Array.from(out)).toHaveLength(41);
    expect(out).toBe(`${"😀".repeat(40)}…`);
  });
  it("CHAT-AC-31 · chuỗi rỗng hoặc chỉ tiền tố cho '…' [U-1]", () => {
    expect(deriveTitle("")).toBe("…");
    expect(deriveTitle("   ")).toBe("…");
    expect(deriveTitle("#scn:steps")).toBe("…");
    expect(deriveTitle("#scn:steps   ")).toBe("…");
  });
});

describe("foldVi / matchesQuery", () => {
  it("CHAT-AC-23 · foldVi bỏ dấu, Đ/đ thành d, hạ chữ thường [U-2]", () => {
    expect(foldVi("Hoá Đơn")).toBe("hoa don");
    expect(foldVi("Đường đi")).toBe("duong di");
  });
  it("CHAT-AC-23 · khớp không phân biệt dấu và hoa thường [U-3]", () => {
    expect(matchesQuery("Hoá đơn tháng 9…", "hoa don")).toBe(true);
    expect(matchesQuery("Hoá đơn tháng 9…", "HÓA ĐƠN")).toBe(true);
    expect(matchesQuery("Hoá đơn tháng 9…", "báo cáo")).toBe(false);
  });
  it("CHAT-AC-23 · q trống, chỉ khoảng trắng hoặc undefined thì khớp mọi tiêu đề [U-3]", () => {
    expect(matchesQuery("Bất kỳ", "")).toBe(true);
    expect(matchesQuery("Bất kỳ", "   ")).toBe(true);
    expect(matchesQuery("Bất kỳ", undefined)).toBe(true);
  });
  it("CHAT-AC-23 · q được trim hai đầu [U-3]", () => {
    expect(matchesQuery("Hoá đơn", "  hoa  ")).toBe(true);
  });
});

describe("isFlowIdle", () => {
  const last = "2026-10-04T08:00:00.000Z";
  const t0 = Date.parse(last);
  it("CHAT-AC-16 · đúng 600 s không hoạt động thì nghỉ [U-4]", () => {
    expect(isFlowIdle(last, t0 + 600_000)).toBe(true);
  });
  it("CHAT-AC-16 · 599 999 ms thì chưa nghỉ [U-4]", () => {
    expect(isFlowIdle(last, t0 + 599_999)).toBe(false);
  });
  it("CHAT-AC-16 · idleS tuỳ chọn thay ngưỡng mặc định [U-4]", () => {
    expect(isFlowIdle(last, t0 + 60_000, 60)).toBe(true);
    expect(isFlowIdle(last, t0 + 59_999, 60)).toBe(false);
  });
});

describe("isNewEvent", () => {
  it("CHAT-AC-28 · id bằng lastId là lặp, lớn hơn là mới [U-7]", () => {
    expect(isNewEvent(5, 5)).toBe(false);
    expect(isNewEvent(4, 5)).toBe(false);
    expect(isNewEvent(6, 5)).toBe(true);
  });
});

function parseAll(chunks: string[]): RawSseEvent[] {
  const out: RawSseEvent[] = [];
  const feed = createSseParser((e) => out.push(e));
  for (const c of chunks) feed(c);
  return out;
}

describe("createSseParser", () => {
  it("CHAT-AC-28 · chunk cắt giữa dòng vẫn ra đúng một khung [U-5]", () => {
    const out = parseAll(["id: 1\nev", "ent: delta\nda", 'ta: {"text":"a"}\n', "\n"]);
    expect(out).toEqual([{ id: "1", event: "delta", data: '{"text":"a"}' }]);
  });
  it("CHAT-AC-28 · chunk cắt giữa \\r\\n và dòng trống \\r\\n [U-5]", () => {
    const out = parseAll(["id: 2\r", "\nevent: delta\r\ndata: x\r\n\r", "\n"]);
    expect(out).toEqual([{ id: "2", event: "delta", data: "x" }]);
  });
  it("CHAT-AC-33 · dòng chú thích ': ping' bị bỏ, không phát khung [U-5]", () => {
    expect(parseAll([": ping\n\n"])).toEqual([]);
    const out = parseAll([": ping\n\nid: 3\nevent: delta\ndata: y\n\n"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("3");
  });
  it("CHAT-AC-28 · hai dòng data nối bằng \\n [U-5]", () => {
    const out = parseAll(["id: 4\nevent: delta\ndata: a\ndata: b\n\n"]);
    expect(out[0]?.data).toBe("a\nb");
  });
  it("CHAT-AC-28 · id vắng cho null [U-5]", () => {
    const out = parseAll(["event: delta\ndata: z\n\n"]);
    expect(out).toEqual([{ id: null, event: "delta", data: "z" }]);
  });
  it("CHAT-AC-28 · nhiều khung trong một chunk ra theo thứ tự [U-5]", () => {
    const out = parseAll(["id: 1\nevent: a\ndata: 1\n\nid: 2\nevent: b\ndata: 2\n\n"]);
    expect(out.map((e) => e.id)).toEqual(["1", "2"]);
  });
});

const VALID: ChatEvent[] = [
  {
    id: 1,
    event: "run.started",
    data: { run_id: RUN, flow_id: FLOW, quota: { state: "warn", pct: 85 } },
  },
  { id: 2, event: "step.started", data: { step_id: "s1", label: "Đọc dữ liệu" } },
  { id: 3, event: "step.finished", data: { step_id: "s1", status: "ok", ms: 210 } },
  { id: 4, event: "delta", data: { text: "Xin chào" } },
  { id: 5, event: "ask", data: { question: "Chọn tháng nào?", choices: ["9", "10"] } },
  {
    id: 6,
    event: "run.finished",
    data: { run_id: RUN, message_id: MSG, content: "Xin chào", ms: 900 },
  },
  {
    id: 7,
    event: "run.failed",
    data: { run_id: RUN, message_id: MSG, code: "INTERNAL_ERROR", message: "Lỗi", hint: "" },
  },
];
const raw = (e: ChatEvent): RawSseEvent => ({
  id: String(e.id),
  event: e.event,
  data: JSON.stringify(e.data),
});

/** Tên lỗi ném ra ("none" nếu không ném); tránh import zod trực tiếp từ tests/. */
function errName(fn: () => unknown): string {
  try {
    fn();
    return "none";
  } catch (e) {
    return e instanceof Error ? e.name : "unknown";
  }
}

describe("toChatEvent", () => {
  it("CHAT-AC-33 · khung hợp lệ thành ChatEvent đúng loại [U-6]", () => {
    const e = toChatEvent(raw(VALID[3] as ChatEvent));
    expect(e).toEqual({ id: 4, event: "delta", data: { text: "Xin chào" } });
  });
  it("CHAT-AC-30 · data có agent hoặc provider bị từ chối bằng ZodError [U-6]", () => {
    const a = { id: "4", event: "delta", data: '{"text":"a","agent":"x"}' };
    const p = { id: "4", event: "delta", data: '{"text":"a","provider":"y"}' };
    expect(errName(() => toChatEvent(a))).toBe("ZodError");
    expect(errName(() => toChatEvent(p))).toBe("ZodError");
  });
  it("CHAT-AC-33 · JSON hỏng ném SyntaxError [U-6]", () => {
    expect(() => toChatEvent({ id: "4", event: "delta", data: "{oops" })).toThrow(SyntaxError);
  });
  it("CHAT-AC-33 · tên event lạ ném ZodError [U-6]", () => {
    expect(errName(() => toChatEvent({ id: "4", event: "mystery", data: "{}" }))).toBe("ZodError");
  });
});

describe("encodeSseEvent", () => {
  it("CHAT-AC-31 · khứ hồi encode, parse, toChatEvent bằng nhau cho cả 7 loại [U-8]", () => {
    expect(new Set(VALID.map((e) => e.event)).size).toBe(7);
    const frames = parseAll([VALID.map(encodeSseEvent).join("")]);
    expect(frames.map(toChatEvent)).toEqual(VALID);
  });
  it("CHAT-AC-31 · khung là id/event/data một dòng, kết thúc bằng dòng trống [U-8]", () => {
    const s = encodeSseEvent(VALID[3] as ChatEvent);
    expect(s).toBe('id: 4\nevent: delta\ndata: {"text":"Xin chào"}\n\n');
  });
});
