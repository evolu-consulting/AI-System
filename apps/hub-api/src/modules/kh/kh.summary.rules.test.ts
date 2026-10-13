// HUB-FR-133 · HUB-FR-132 · plan K1 §2.4–2.5 — ca biên ngoài test khoá (tests/acceptance/K1/rules/kh-{query,summary}-rules).
import { describe, expect, test } from "bun:test";
import { khPackHits } from "./kh.query.rules";
import { clipWords, ensureSummary, summaryForWorklog } from "./kh.summary.rules";

describe("summaryForWorklog biên", () => {
  test("HUB-FR-133 · heading tổ hợp (NFD) + hoa thường khớp; '###' bên trong giữ nguyên; xuống dòng giữ", () => {
    const md = `## ${"TÓM TẮT".normalize("NFD")}\nDòng 1\n### Chi tiết\nDòng 2\n## Khác\nx`;
    expect(summaryForWorklog(md)).toBe("Dòng 1\n### Chi tiết\nDòng 2");
  });
  test("HUB-FR-133 · clipWords n = 0 ⇒ ''; ensureSummary không trùng khi khác hoa thường", () => {
    expect(clipWords("a b", 0)).toBe("");
    expect(ensureSummary(["tóm tắt"], true)).toEqual(["tóm tắt"]);
  });
});

describe("khPackHits biên", () => {
  test("HUB-FR-132 · source_text toàn khoảng trắng bị bỏ; vừa khít budget ⇒ không cut", () => {
    expect(khPackHits({ hits: [{ score: 1, source_text: "   " }] })).toEqual({
      text: "",
      hits: 0,
      used_chars: 0,
      cut_at_budget: false,
    });
    expect(khPackHits({ hits: [{ score: 1, source_text: "abc" }] }, 5)).toEqual({
      text: "- abc",
      hits: 1,
      used_chars: 5,
      cut_at_budget: false,
    });
  });
  test("HUB-FR-132 · G10 · hết budget trước hit kế ⇒ không đếm hit đó", () => {
    const r = khPackHits(
      {
        hits: [
          { score: 2, source_text: "abc" },
          { score: 1, source_text: "d" },
        ],
      },
      6,
    );
    expect(r).toEqual({ text: "- abc", hits: 1, used_chars: 5, cut_at_budget: true });
  });
});
