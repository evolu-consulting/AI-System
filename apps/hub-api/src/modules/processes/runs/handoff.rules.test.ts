// HUB-FR-136 · R10/R11 · unit `handoff.rules` (phần ngoài test khoá RH-*): handoffOf / handoffTruncated / askHistoryBlock.
import { describe, expect, it } from "bun:test";
import { askHistoryBlock, handoffBlock, handoffOf, handoffTruncated } from "./handoff.rules";

describe("HUB-FR-136 · handoff.rules", () => {
  it("handoffOf đọc mục `## Bàn giao` (không phân biệt hoa thường), bỏ `###`; vắng/rỗng ⇒ null", () => {
    expect(handoffOf("## Kết quả\nx\n\n## bàn GIAO\n  HO  \n")).toBe("HO");
    expect(handoffOf("## Kết quả\nx\n### Bàn giao\ny")).toBeNull();
    expect(handoffOf("## Bàn giao\n\n")).toBeNull();
  });
  it("handoffTruncated: > 800 ký tự (code point) ⇒ true; đúng 800 ⇒ false; không mục ⇒ false", () => {
    expect(handoffTruncated(`## Bàn giao\n${"ê".repeat(801)}`)).toBe(true);
    expect(handoffTruncated(`## Bàn giao\n${"ê".repeat(800)}`)).toBe(false);
    expect(handoffTruncated("## Khác\nx")).toBe(false);
  });
  it("handoffBlock bỏ mục rỗng/khoảng trắng, giữ thứ tự", () => {
    const t = handoffBlock([
      { name: "A", file: "s0-v1-a.md", handoff: "  " },
      { name: "B", file: "s1-v2-b.md", handoff: "HB" },
    ]);
    expect(t).toBe("Bàn giao từ bước trước:\n\n### B (s1-v2-b.md)\nHB");
  });
  it("askHistoryBlock: rỗng ⇒ null; nhiều cặp nối theo thứ tự", () => {
    expect(askHistoryBlock([])).toBeNull();
    expect(askHistoryBlock([{ question: "Q1", answer: "A1" }])).toBe(
      "Câu hỏi trước:\nQ1\nTrả lời:\nA1",
    );
  });
  it("handoffOf khớp heading Unicode tổ hợp (NFD) ≡ dựng sẵn (NFC)", () => {
    const nfd = "## Bàn giao".normalize("NFD");
    expect(handoffOf(`${nfd}\nHO`)).toBe("HO");
  });
});
