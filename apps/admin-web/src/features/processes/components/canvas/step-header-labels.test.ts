// CR-105 UX: tiêu đề cột của Sơ đồ quy trình khe chỉ đếm bước duyệt; cột nút hệ thống không số.
import { describe, expect, test } from "bun:test";
import { stepHeaderLabels } from "./stage-view";

const review = (step: number, no: number) => ({
  step,
  slotInfo: { no, dept: "", dueH: null, cond: null },
  sys: null,
});
const sys = (step: number, kind: "route" | "finalize") => ({ step, slotInfo: null, sys: kind });
const plain = (step: number) => ({ step, slotInfo: null, sys: null });

describe("stepHeaderLabels", () => {
  test("s0(0) → route(1) → s1(2) → finalize(3): Bước 1, (trống), Bước 2, (trống)", () => {
    const m = stepHeaderLabels([review(0, 1), sys(1, "route"), review(2, 2), sys(3, "finalize")]);
    expect([...(m ?? [])]).toEqual([
      [0, 1],
      [1, null],
      [2, 2],
      [3, null],
    ]);
  });
  test("sau khi thêm bước: số theo thứ tự bước duyệt, không tính route/finalize", () => {
    const m = stepHeaderLabels([
      review(0, 1),
      sys(1, "route"),
      review(2, 2),
      review(3, 3),
      sys(4, "finalize"),
    ]);
    expect(m?.get(3)).toBe(3);
    expect(m?.get(4)).toBeNull();
  });
  test("quy trình thường (không bước khe / nút hệ thống) ⇒ null (giữ cách đếm cũ)", () => {
    expect(stepHeaderLabels([plain(0), plain(1)])).toBeNull();
  });
});
