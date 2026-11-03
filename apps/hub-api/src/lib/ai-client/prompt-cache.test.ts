// CR-114 hub-fast-sdk · prompt caching: tiền tố (bỏ dấu `cache_control`) tới breakpoint history của lượt N là tiền tố BYTE
// của lượt N+1 qua 3 lượt; phần biến động (dòng giờ) nằm sau breakpoint cuối; tools sắp theo tên.
import { describe, expect, it } from "bun:test";
import {
  blockWindowDrop,
  type CachedPrompt,
  type CacheTurn,
  cachedPrompt,
  historyBlock,
  promptTokens,
} from "./prompt-cache";

const strip = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (k, x) => (k === "cache_control" ? undefined : x)));

/** Tiền tố đã đánh dấu cache: system + messages tới (gồm) tin cuối có `cache_control`. */
function cachedPrefix(p: CachedPrompt): string {
  const last = p.messages.findLastIndex(
    (m) =>
      Array.isArray(m.content) && m.content.some((b) => "cache_control" in b && b.cache_control),
  );
  return JSON.stringify(
    strip({ system: p.system, tools: p.tools, messages: p.messages.slice(0, last + 1) }),
  );
}
const full = (p: CachedPrompt): string => JSON.stringify(strip(p));

describe("CR-114 · prompt-cache", () => {
  it("prompt-cache prefix stable across 3 turns", () => {
    const base = { system: "Bạn là trợ lý.", context: "tenant=acme; agent=assistant v3" };
    const history: CacheTurn[] = [];
    const turns: CachedPrompt[] = [];
    for (const [i, q] of ["Xin chào", "Hợp đồng A?", "Còn B?"].entries()) {
      turns.push(cachedPrompt({ ...base, history, volatile: `Bây giờ: 10:0${i}`, prompt: q }));
      history.push({ role: "user", content: q }, { role: "assistant", content: `trả lời ${i}` });
    }
    for (let n = 1; n < turns.length; n++) {
      const prev = cachedPrefix(turns[n - 1] as CachedPrompt).slice(0, -2); // bỏ `]}` đóng
      expect(full(turns[n] as CachedPrompt).startsWith(prev)).toBe(true);
    }
    // Lượt 3: breakpoint ở system, ngữ cảnh, cuối history (≤ 4); dòng giờ sau breakpoint cuối.
    const t3 = turns[2] as CachedPrompt;
    expect(t3.system.every((b) => b.cache_control?.type === "ephemeral")).toBe(true);
    const marks = t3.messages.filter((m) => JSON.stringify(m).includes("cache_control"));
    expect(marks).toHaveLength(1);
    expect(JSON.stringify(t3.messages.at(-1))).not.toContain("cache_control");
    expect(JSON.stringify(t3.messages.at(-1))).toContain("Bây giờ: 10:02");
  });

  it("leading assistant turns are dropped and tools sorted by name", () => {
    const tool = (name: string) => ({ name, input_schema: { type: "object" as const } });
    const p = cachedPrompt({
      system: "s",
      tools: [tool("b"), tool("a")],
      history: [{ role: "assistant", content: "x" }],
      prompt: "q",
    });
    expect(p.messages).toHaveLength(1);
    expect(p.tools?.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("history window shifts by block, keeping the start stable", () => {
    const n = 20;
    const block = historyBlock(n);
    expect(block).toBe(10);
    expect(historyBlock(40)).toBe(16);
    expect(blockWindowDrop(15, n, block)).toBe(0); // chưa đầy cửa sổ
    // Điểm bắt đầu tuyệt đối = total − n + drop: không đổi trong cả khối, nhảy đúng `block` khi qua khối.
    const starts = [21, 22, 25, 30, 31, 40].map((t) => t - n + blockWindowDrop(t, n, block));
    expect(starts).toEqual([10, 10, 10, 10, 20, 20]);
    for (let t = n + 1; t < 200; t++) {
      const kept = n - blockWindowDrop(t, n, block);
      expect(kept).toBeGreaterThan(n - block);
      expect(kept).toBeLessThanOrEqual(n);
    }
  });

  it("promptTokens counts cached input", () => {
    expect(
      promptTokens({
        input_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 7,
      }),
    ).toBe(112);
  });
});
