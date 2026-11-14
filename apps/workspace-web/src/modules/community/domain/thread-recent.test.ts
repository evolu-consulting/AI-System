import { describe, expect, test } from "bun:test";
import { visibleComments } from "./thread";

describe("visibleComments (CR-147)", () => {
  test("5 bình luận ⇒ hiện 2 mới nhất, ẩn 3", () => {
    expect(visibleComments([1, 2, 3, 4, 5], 2, false)).toEqual({ shown: [4, 5], hidden: 3 });
  });
  test("≤ 2 bình luận ⇒ hiện hết, không có «Xem thêm»", () => {
    expect(visibleComments([1, 2], 2, false)).toEqual({ shown: [1, 2], hidden: 0 });
    expect(visibleComments([], 2, false)).toEqual({ shown: [], hidden: 0 });
  });
  test("đã bấm «Xem thêm» ⇒ hiện hết", () => {
    expect(visibleComments([1, 2, 3], 2, true)).toEqual({ shown: [1, 2, 3], hidden: 0 });
  });
});
