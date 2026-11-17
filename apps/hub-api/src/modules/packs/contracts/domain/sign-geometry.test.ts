import { describe, expect, test } from "bun:test";
import type { SignPart } from "@ai/contracts/pack-contracts";
import { SignError } from "./sign-error";
import {
  applyMatrix,
  displaySize,
  displayToUser,
  normRotate,
  type PageView,
  resolveParts,
} from "./sign-geometry";

const pg = (rotate = 0, o: Partial<PageView> = {}): PageView => ({
  x: 0,
  y: 0,
  width: 600,
  height: 800,
  rotate,
  ...o,
});
const part = (o: Partial<SignPart> = {}): SignPart => ({
  page: 0,
  x: 100,
  y: 100,
  w: 240,
  h: 100,
  cx: 100,
  cy: 100,
  cw: 240,
  ch: 100,
  ...o,
});
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof SignError ? e.code : "other";
  }
  return "none";
};

describe("normRotate / displaySize", () => {
  test("chuẩn hoá âm và > 360; giá trị lạ ⇒ SIGN_PDF_INVALID", () => {
    expect(normRotate(-90)).toBe(270);
    expect(normRotate(450)).toBe(90);
    expect(code(() => normRotate(45))).toBe("SIGN_PDF_INVALID");
  });
  test("90/270 đổi chỗ rộng ↔ cao", () => {
    expect(displaySize(pg(0))).toEqual({ w: 600, h: 800 });
    expect(displaySize(pg(90))).toEqual({ w: 800, h: 600 });
    expect(displaySize(pg(270))).toEqual({ w: 800, h: 600 });
    expect(displaySize(pg(180))).toEqual({ w: 600, h: 800 });
  });
});

describe("displayToUser", () => {
  test("gốc hiển thị (0,0) và góc trên-phải về đúng góc trang chưa xoay", () => {
    const o = { x: 10, y: 20 };
    // r0
    expect(applyMatrix(displayToUser(pg(0, o)), 0, 0)).toEqual([10, 20]);
    // góc đáy-trái / trên-phải hiển thị về góc trang chưa xoay
    expect(applyMatrix(displayToUser(pg(90, o)), 0, 0)).toEqual([610, 20]);
    expect(applyMatrix(displayToUser(pg(90, o)), 800, 600)).toEqual([10, 820]);
    expect(applyMatrix(displayToUser(pg(180, o)), 0, 0)).toEqual([610, 820]);
    expect(applyMatrix(displayToUser(pg(180, o)), 600, 800)).toEqual([10, 20]);
    expect(applyMatrix(displayToUser(pg(270, o)), 0, 0)).toEqual([10, 820]);
    expect(applyMatrix(displayToUser(pg(270, o)), 800, 600)).toEqual([610, 20]);
  });
  test("90: điểm bất kỳ — xoay thuận chiều rồi hiển thị khớp ngược", () => {
    // (ux,uy) chưa xoay → hiển thị CW 90: (dx,dy)=(uy, W-ux). Nghịch đảo phải trả (ux,uy).
    const [ux, uy] = [123, 456];
    const [dx, dy] = [uy, 600 - ux];
    expect(applyMatrix(displayToUser(pg(90)), dx, dy)).toEqual([ux, uy]);
    // 270: (dx,dy)=(H-uy, ux)
    expect(applyMatrix(displayToUser(pg(270)), 800 - uy, ux)).toEqual([ux, uy]);
    // 180: (W-ux, H-uy)
    expect(applyMatrix(displayToUser(pg(180)), 600 - ux, 800 - uy)).toEqual([ux, uy]);
  });
});

describe("resolveParts (BR-L3, BR-L4)", () => {
  const pages = [pg(0), pg(0), pg(90)];
  test("phần nằm gọn trang: giữ nguyên", () => {
    const r = resolveParts([part()], pages);
    expect(r).toEqual([
      {
        page: 0,
        frame: { x: 100, y: 100, w: 240, h: 100 },
        clip: { x: 100, y: 100, w: 240, h: 100 },
      },
    ]);
  });
  test("phần tràn mép phải/trên/trái/dưới bị cắt theo trang", () => {
    const r = resolveParts([part({ cx: 500, cy: 750, cw: 240, ch: 100 })], pages);
    expect(r[0]?.clip).toEqual({ x: 500, y: 750, w: 100, h: 50 });
    const r2 = resolveParts([part({ cx: -40, cy: -10, cw: 100, ch: 100 })], pages);
    expect(r2[0]?.clip).toEqual({ x: 0, y: 0, w: 60, h: 90 });
  });
  test("trang xoay 90: dùng cỡ hiển thị 800×600", () => {
    const r = resolveParts([part({ page: 2, cx: 700, cy: 500, cw: 300, ch: 300 })], pages);
    expect(r[0]?.clip).toEqual({ x: 700, y: 500, w: 100, h: 100 });
  });
  test("giáp lai: phần ngoài trang bị bỏ, phần còn lại giữ", () => {
    const r = resolveParts(
      [part({ page: 0, cx: 500, cw: 95 }), part({ page: 1, x: -95, cx: 0, cw: 95 })],
      pages,
    );
    expect(r.map((p) => p.page)).toEqual([0, 1]);
    const r2 = resolveParts(
      [part({ page: 0, cx: 700, cw: 50 }), part({ page: 1, cx: 0, cw: 95 })],
      pages,
    );
    expect(r2.map((p) => p.page)).toEqual([1]);
  });
  test("không còn phần nào trong trang ⇒ SIGN_OUTSIDE_PAGE (kể cả chỉ chạm mép)", () => {
    expect(code(() => resolveParts([part({ cx: 700, cw: 50 })], pages))).toBe("SIGN_OUTSIDE_PAGE");
    expect(code(() => resolveParts([part({ cx: 600, cw: 50 })], pages))).toBe("SIGN_OUTSIDE_PAGE");
    expect(code(() => resolveParts([part({ cx: -60, cw: 60 })], pages))).toBe("SIGN_OUTSIDE_PAGE");
  });
  test("trang không tồn tại ⇒ SIGN_PAGE_NOT_FOUND; không liên tiếp / rỗng / > 5 ⇒ SIGN_PARTS_INVALID", () => {
    expect(code(() => resolveParts([part({ page: 3 })], pages))).toBe("SIGN_PAGE_NOT_FOUND");
    expect(code(() => resolveParts([part({ page: 0 }), part({ page: 2 })], pages))).toBe(
      "SIGN_PARTS_INVALID",
    );
    expect(code(() => resolveParts([], pages))).toBe("SIGN_PARTS_INVALID");
    const six = [0, 1, 2, 3, 4, 5].map((page) => part({ page }));
    expect(code(() => resolveParts(six, pages))).toBe("SIGN_PARTS_INVALID");
  });
});
