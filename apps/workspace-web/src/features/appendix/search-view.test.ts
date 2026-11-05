import { describe, expect, test } from "bun:test";
import { searchView } from "./search-view";

describe("searchView", () => {
  test("chưa gõ đủ ⇒ gợi ý; đang tải ⇒ loading; gõ mà trống ⇒ empty; có kết quả ⇒ list", () => {
    const b = { text: "", searching: false, suggesting: false, options: 0 };
    expect(searchView(b)).toBe("hint");
    expect(searchView({ ...b, text: "a" })).toBe("hint");
    expect(searchView({ ...b, text: "ab", searching: true })).toBe("loading");
    expect(searchView({ ...b, text: "ab" })).toBe("empty");
    expect(searchView({ ...b, text: "ab", options: 2, searching: true })).toBe("list");
  });
});
