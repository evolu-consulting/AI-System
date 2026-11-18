// C6 · unit logic thuần luồng bình luận + mock sửa/xoá/ẩn.
import { describe, expect, test } from "bun:test";
import { activeMention, commentActions, splitMentions } from "./thread";

describe("commentActions", () => {
  test("người viết sửa/xoá; chỉ chủ quản ẩn và chỉ trên bài chủ quản", () => {
    expect(commentActions({ mine: true }, { isHost: false, postByHost: true })).toEqual({
      edit: true,
      delete: true,
      hide: false,
    });
    expect(commentActions({ mine: false }, { isHost: true, postByHost: true })).toEqual({
      edit: false,
      delete: false,
      hide: true,
    });
    expect(commentActions({ mine: false }, { isHost: true, postByHost: false }).hide).toBe(false);
  });
});

describe("activeMention", () => {
  test("nhận biết đang gõ @ đầu từ", () => {
    expect(activeMention("Chào @Tân", 9)).toEqual({ start: 5, query: "Tân" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
  });
  test("email / xuống dòng / @ khác ⇒ không", () => {
    expect(activeMention("a@b", 3)).toBeNull();
    expect(activeMention("@Tân\nxin", 9)).toBeNull();
    expect(activeMention("không có", 3)).toBeNull();
  });
});

describe("splitMentions", () => {
  test("tách đoạn để tô đậm", () => {
    expect(splitMentions("Hi @Tân Phát ok", [{ name: "Tân Phát" }])).toEqual([
      { text: "Hi ", mention: false },
      { text: "@Tân Phát", mention: true },
      { text: " ok", mention: false },
    ]);
    expect(splitMentions("x", [])).toEqual([{ text: "x", mention: false }]);
  });
});
