import { describe, expect, test } from "bun:test";
import { cutPending } from "./pending";

describe("cutPending", () => {
  test("≤ 3 yêu cầu ⇒ hiện hết, không nút", () => {
    expect(cutPending(2, 1, false)).toMatchObject({ connectShown: 2, hidden: 0, canToggle: false });
  });
  test("5 yêu cầu (2 kết nối + 3 vào Bảng tin) ⇒ 3 dòng, «Xem thêm 2»", () => {
    const c = cutPending(2, 3, false);
    expect(c).toMatchObject({ connectShown: 2, joinBudget: 1, hidden: 2, canToggle: true });
  });
  test("5 yêu cầu kết nối ⇒ chỉ 3 dòng, không dòng Bảng tin", () => {
    expect(cutPending(5, 0, false)).toMatchObject({ connectShown: 3, joinBudget: 0, hidden: 2 });
  });
  test("mở rộng ⇒ hiện hết, còn nút «Thu gọn»", () => {
    expect(cutPending(2, 3, true)).toMatchObject({ connectShown: 2, hidden: 0, canToggle: true });
  });
});
