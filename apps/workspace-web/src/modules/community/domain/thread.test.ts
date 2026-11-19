// C6 · unit logic thuần luồng bình luận + mock sửa/xoá/ẩn.
import { describe, expect, test } from "bun:test";
import { activeMention, commentActions, splitMentions } from "./thread";

describe("commentActions", () => {
  test("CR-191 · moderate (người đăng/quản trị) ⇒ ẩn + xoá bình luận người khác — bài đối tác không moderate ⇒ chỉ của mình", () => {
    expect(
      commentActions({ mine: false, moderate: true }, { isHost: true, postByHost: true }),
    ).toEqual({
      edit: false,
      delete: true,
      hide: true,
    });
    expect(commentActions({ mine: true }, { isHost: true, postByHost: false })).toEqual({
      edit: true,
      delete: true,
      hide: false,
    });
  });
  test("người viết sửa/xoá — chỉ chủ quản ẩn và chỉ trên bài chủ quản", () => {
    expect(commentActions({ mine: true }, { isHost: false, postByHost: true })).toEqual({
      edit: true,
      delete: true,
      hide: false,
    });
    // soát Opus #1 (G3): chỉ người máy chủ báo `moderate` (người đăng / quản trị) mới có Ẩn
    expect(commentActions({ mine: false }, { isHost: true, postByHost: true })).toEqual({
      edit: false,
      delete: false,
      hide: false,
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
