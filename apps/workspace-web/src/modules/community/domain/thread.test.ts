// C6 · unit logic thuần luồng bình luận + mock sửa/xoá/ẩn.
import { describe, expect, test } from "bun:test";
import {
  activeMention,
  commentActions,
  filterMentionables,
  insertMention,
  mentionIds,
  moveIndex,
  splitMentions,
} from "./thread";

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

describe("insertMention / mentionIds / splitMentions", () => {
  const picked = [
    { orgId: "o1", name: "Tân Phát" },
    { orgId: "o2", name: "ABC" },
  ];
  test("chèn thay chữ đang gõ và đặt con trỏ", () => {
    const r = insertMention("Chào @Tâ", 5, 8, "Tân Phát");
    expect(r).toEqual({ text: "Chào @Tân Phát ", caret: 15 });
  });
  test("xoá chữ ⇒ bỏ nhắc; không trùng", () => {
    expect(mentionIds("Gửi @Tân Phát và @Tân Phát", picked)).toEqual(["o1"]);
    expect(mentionIds("Gửi Tân Phát", picked)).toEqual([]);
    expect(mentionIds("@ABC @Tân Phát", picked, 1)).toEqual(["o1"]);
  });
  test("tách đoạn để tô đậm", () => {
    expect(splitMentions("Hi @Tân Phát ok", [{ name: "Tân Phát" }])).toEqual([
      { text: "Hi ", mention: false },
      { text: "@Tân Phát", mention: true },
      { text: " ok", mention: false },
    ]);
    expect(splitMentions("x", [])).toEqual([{ text: "x", mention: false }]);
  });
});

describe("filterMentionables / moveIndex", () => {
  test("lọc không phân biệt hoa thường", () => {
    const l = [
      { orgId: "1", name: "Tân Phát" },
      { orgId: "2", name: "ABC" },
    ];
    expect(filterMentionables(l, "abc").map((m) => m.orgId)).toEqual(["2"]);
    expect(filterMentionables(l, " ")).toEqual(l);
  });
  test("vòng tròn", () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});
