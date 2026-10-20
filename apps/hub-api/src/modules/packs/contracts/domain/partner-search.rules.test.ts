// V2-I · DT-07 · Q8: luật thuần "Tìm trên internet" — lời nhắc chỉ có tên + MST; đầu ra AI ⇒ dòng chữ thuần, có trần.
import { describe, expect, it } from "bun:test";
import { cliArgs } from "../../../../lib/ai-client/claude-cli.provider";
import {
  parseSearchLines,
  SEARCH_MAX_LINES,
  SEARCH_SUMMARY_MAX,
  searchPrompt,
} from "./partner-search.rules";

describe("V2-I partner-search.rules", () => {
  it("lời nhắc chỉ gồm tên + MST (một dòng mỗi trường, có trần)", () => {
    const p = searchPrompt("Công ty\nABC  ", "0311110001");
    expect(p).toBe("Tên doanh nghiệp: Công ty ABC\nMã số thuế: 0311110001");
    expect(searchPrompt("X", null)).toContain("(không có)");
    expect(searchPrompt("a".repeat(500), "9".repeat(99)).length).toBeLessThan(270);
  });

  it("đọc mảng JSON (kể cả bọc trong chữ), bỏ mục rỗng, cắt độ dài, tối đa 6 dòng", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      title: `T${i}`,
      summary: "s".repeat(500),
      source: i === 0 ? "gdt.gov.vn" : "",
    }));
    const out = parseSearchLines(
      `Kết quả:\n${JSON.stringify([...items, 5, {}, { title: "" }])}\nHết.`,
    );
    expect(out).toHaveLength(SEARCH_MAX_LINES);
    expect(out[0]).toEqual({
      title: "T0",
      summary: "s".repeat(SEARCH_SUMMARY_MAX),
      source: "gdt.gov.vn",
    });
    expect(out[1]?.source).toBeNull();
  });

  it("không có JSON ⇒ mỗi dòng văn bản là một dòng; rỗng / [] ⇒ không dòng nào", () => {
    expect(parseSearchLines("- Đang hoạt động\n\n* Có website riêng").map((l) => l.title)).toEqual([
      "Đang hoạt động",
      "Có website riêng",
    ]);
    expect(parseSearchLines("[]")).toEqual([]);
    expect(parseSearchLines("")).toEqual([]);
  });

  it("CLI: tìm web mở đúng MỘT công cụ WebSearch; mặc định vẫn không công cụ", () => {
    const a = cliArgs("m", "s", true);
    expect(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 4)).toEqual([
      "--tools",
      "WebSearch",
      "--allowedTools",
      "WebSearch",
    ]);
    expect(cliArgs("m", "s")[cliArgs("m", "s").indexOf("--tools") + 1]).toBe("");
    expect(cliArgs("m", "s").includes("--allowedTools")).toBe(false);
  });
});
