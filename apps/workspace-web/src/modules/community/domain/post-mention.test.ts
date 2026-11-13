// CR-145 · loại bài mặc định + «Nhắc tên» (logic thuần của Composer).
import { describe, expect, test } from "bun:test";
import { addMention, defaultPostType, mentionIds, mentionScope } from "./mention";

const u = (n: number) => ({
  userId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Người ${n}`,
});

describe("defaultPostType · loại bài mặc định", () => {
  test("chủ quản (được đăng «Thông báo») ⇒ note", () => {
    expect(defaultPostType(["sell", "buy", "note"])).toBe("note");
  });
  test("đối tác ⇒ loại đầu tiên được phép", () => {
    expect(defaultPostType(["buy"])).toBe("buy");
    expect(defaultPostType(["sell", "buy"])).toBe("sell");
  });
  test("chưa có loại nào ⇒ sell (không vỡ)", () => {
    expect(defaultPostType([])).toBe("sell");
  });
});

describe("addMention · chọn người", () => {
  test("không trùng người; tối đa 10", () => {
    const one = addMention([], u(1));
    expect(addMention(one, u(1))).toHaveLength(1);
    let list = one;
    for (let i = 2; i <= 12; i++) list = addMention(list, u(i));
    expect(list).toHaveLength(10);
  });
});

describe("mentionIds / mentionScope", () => {
  test("id theo thứ tự chọn; phạm vi nháp mang loại + người xem (chủ quản)", () => {
    expect(mentionIds([u(1), u(2)])).toEqual([u(1).userId, u(2).userId]);
    expect(
      mentionScope({
        type: "note",
        cats: ["a"],
        audience: { mode: "suppliers", cats: [], companies: [] },
      }),
    ).toEqual({ type: "note", cats: ["a"], mode: "suppliers", audCats: [], companies: [] });
    expect(mentionScope({ type: "sell", cats: [] })).toEqual({ type: "sell", cats: [] });
  });
});
