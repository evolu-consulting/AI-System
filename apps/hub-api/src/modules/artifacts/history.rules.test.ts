// CR-114 · hub-agent-handoff · nén lịch sử hội thoại dài.
import { describe, expect, it } from "bun:test";
import type { HistoryItem } from "@ai/contracts/hub";
import {
  compactHistory,
  olderBody,
  SUMMARY_LINE_MAX,
  SUMMARY_MAX,
  splitHistory,
} from "./history.rules";

const turns = (n: number): HistoryItem[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `lượt ${i} ${"nội dung ".repeat(30)}`,
  }));

describe("CR-114 · history.rules", () => {
  it("giữ N lượt cuối nguyên văn", () => {
    const h = turns(10);
    const out = compactHistory(h, { keep: 4, ref: "art:3f9c21e8" });
    expect(out).toHaveLength(5);
    expect(out.slice(1)).toEqual(h.slice(6));
    const head = out[0] as HistoryItem;
    expect(head.role).toBe("assistant");
    expect(head.content.split("\n")[0]).toBe("[6 earlier turns · full text: art:3f9c21e8]");
    expect(head.content.split("\n")).toHaveLength(7);
    for (const l of head.content.split("\n").slice(1))
      expect([...l].length).toBeLessThanOrEqual(SUMMARY_LINE_MAX + 12);
  });

  it("ngắn hơn hoặc bằng N lượt thì giữ nguyên", () => {
    const h = turns(4);
    expect(compactHistory(h, { keep: 4 })).toEqual(h);
    expect(splitHistory(h, 4).older).toEqual([]);
  });

  it("không có khoá thì chỉ tóm tắt; mục tóm tắt không vượt SUMMARY_MAX", () => {
    const out = compactHistory(turns(200), { keep: 2 });
    expect((out[0] as HistoryItem).content.startsWith("[198 earlier turns]")).toBe(true);
    expect([...(out[0] as HistoryItem).content].length).toBeLessThanOrEqual(SUMMARY_MAX);
  });

  it("olderBody = JSON lines giữ nguyên văn", () => {
    const h = turns(2);
    expect(
      olderBody(h)
        .split("\n")
        .map((l) => JSON.parse(l)),
    ).toEqual(h);
  });
});
