// HUB-FR-42 · H1-R12 · phần thuần của SSE: trả lời XREAD RESP2/RESP3, entry `e`, khung SSE (plan §5.2–5.3).
import { describe, expect, it } from "bun:test";
import { sseFrame, xreadPairs } from "./sse/sse-reader";
import { isTerminalEvent, parseEntry } from "./sse/sse-writer";

const ROWS: [string, string[]][] = [["1-0", ["e", '{"event":"delta","data":{"text":"a"}}']]];

describe("HUB-FR-42 · SSE thuần", () => {
  it("HUB-FR-42 · xreadPairs: RESP2 lồng và RESP3 phẳng cho cùng kết quả; null → rỗng", () => {
    expect(xreadPairs([["sse:a", ROWS]])).toEqual([["sse:a", ROWS]]);
    expect(xreadPairs(["sse:a", ROWS, "sse:b", []])).toEqual([
      ["sse:a", ROWS],
      ["sse:b", []],
    ]);
    expect(xreadPairs(null)).toEqual([]);
  });

  it("HUB-FR-42 · parseEntry đọc field `e`; JSON hỏng/thiếu → null", () => {
    expect(parseEntry(["e", '{"event":"delta","data":{"text":"a"}}'])).toEqual({
      event: "delta",
      data: { text: "a" },
    });
    expect(parseEntry(["e", "{"])).toBeNull();
    expect(parseEntry(["x", "{}"])).toBeNull();
  });

  it("H1-R12 · sseFrame: id = seq, data JSON một dòng; sự kiện kết thúc nhận đúng", () => {
    const NL = String.fromCharCode(10);
    const data = { text: `a${NL}b` };
    const frame = sseFrame({ seq: 3, event: "delta", data });
    expect(frame).toBe(["id: 3", "event: delta", `data: ${JSON.stringify(data)}`, "", ""].join(NL));
    expect(frame.split(NL).length).toBe(5);
    expect(isTerminalEvent("run.failed")).toBe(true);
    expect(isTerminalEvent("ask")).toBe(false);
  });
});
