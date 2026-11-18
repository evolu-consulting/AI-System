// CR-182 · xoè quạt: hình học thuần (dải lộ, partsOf theo phần lộ, giáp lai ≤ 5 trang), kiểu xem của chữ ký.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VIEW,
  editableIn,
  FAN_PX,
  groupCount,
  groupRange,
  layoutFan,
  layoutView,
  viewKey,
} from "./fan";
import { isPartsError, partsOf, rectFromParts } from "./geometry";
import { relayoutItems, type SignItem } from "./sign-items";

const A4 = { ptWidth: 600, ptHeight: 800 };
const sizes = (n: number) => Array.from({ length: n }, () => A4);
const W = 900;

describe("bố cục xoè quạt", () => {
  test("mép phải: trang đầu lộ cả trang, trang dưới chỉ lộ dải 40px bên phải", () => {
    const { pages, fan } = layoutFan(sizes(8), W, "right", 0);
    expect(fan).toBe(true);
    expect(pages.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(pages[0]?.visible).toBeUndefined();
    const p1 = pages[1];
    expect(p1?.visible).toEqual({
      l: (p1?.left ?? 0) + (p1?.width ?? 0) - FAN_PX,
      t: p1?.top,
      w: FAN_PX,
      h: p1?.height,
    });
    // dải trang i nằm sát nhau, không chồng lên trang đầu
    const p0 = pages[0];
    expect(p1?.visible?.l).toBe((p0?.left ?? 0) + (p0?.width ?? 0));
  });
  test("mép dưới: dải 40px ở đáy mỗi trang dưới", () => {
    const { pages } = layoutFan(sizes(3), W, "bottom", 0);
    const p1 = pages[1];
    expect(p1?.visible).toEqual({
      l: p1?.left,
      t: (p1?.top ?? 0) + (p1?.height ?? 0) - FAN_PX,
      w: p1?.width,
      h: FAN_PX,
    });
    expect(pages[0]?.top).toBeLessThan(p1?.top ?? 0);
  });
  test("nhóm: 23 trang ⇒ 5 nhóm, nhóm cuối «Trang 21–23», chỉ số trang là toàn cục", () => {
    expect(groupCount(23)).toBe(5);
    expect(groupRange(23, 4)).toEqual({ from: 20, to: 22 });
    expect(groupRange(23, 99)).toEqual({ from: 20, to: 22 });
    expect(layoutFan(sizes(23), W, "right", 1).pages.map((p) => p.index)).toEqual([5, 6, 7, 8, 9]);
  });
  test("«Liền mép» bỏ khe giữa các trang, «Từng trang» vẫn có khe 16px", () => {
    const gap = (lien: boolean) => {
      const { pages } = layoutView(sizes(2), W, { ...DEFAULT_VIEW, lien });
      return (pages[1]?.top ?? 0) - ((pages[0]?.top ?? 0) + (pages[0]?.height ?? 0));
    };
    expect(gap(false)).toBe(16);
    expect(gap(true)).toBe(0);
  });
});

describe("partsOf theo phần lộ", () => {
  const { pages } = layoutFan(sizes(5), W, "right", 0);
  const p0 = pages[0];
  if (!p0) throw new Error("thiếu trang");
  const last = pages[4];

  test("chữ ký đè lên dải của 4 trang dưới + trang đầu ⇒ giáp lai 5 phần, mỗi phần cắt theo dải", () => {
    const r = { l: p0.left + p0.width - 20, t: p0.top + 100, w: 4 * FAN_PX + 40, h: 60 };
    const parts = partsOf(r, pages);
    expect(isPartsError(parts)).toBe(false);
    if (isPartsError(parts)) return;
    expect(parts.map((q) => q.page)).toEqual([0, 1, 2, 3, 4]);
    const k = 600 / p0.width;
    // trang đầu: chỉ lộ 20px cuối; trang dưới: dải đủ 40px
    expect(parts[0]?.cw).toBeCloseTo(20 * k, 5);
    expect(parts[1]?.cw).toBeCloseTo(FAN_PX * k, 5);
    // x,y,w,h luôn là khung ĐẦY ĐỦ của chữ ký trên trang ấy
    for (const q of parts) expect(q.w).toBeCloseTo(r.w * k, 5);
    // toạ độ quy về điểm PDF của trang đầy đủ: phần của trang 1 bắt đầu ở mép dải (không phải mép trái trang)
    const p1 = pages[1];
    expect(parts[1]?.cx).toBeCloseTo(((p1?.visible?.l ?? 0) - (p1?.left ?? 0)) * k, 5);
    expect(parts[1]?.x).toBeCloseTo((r.l - (p1?.left ?? 0)) * k, 5);
  });
  test("chữ ký nằm trọn trên trang đầu ⇒ một phần; không chạm dải ⇒ không có phần của trang dưới", () => {
    const parts = partsOf({ l: p0.left + 10, t: p0.top + 10, w: 100, h: 40 }, pages);
    expect(isPartsError(parts) ? [] : parts.map((q) => q.page)).toEqual([0]);
  });
  test("vùng bị trang đầu che (không phải dải lộ) không tạo phần của trang dưới", () => {
    const covered = { l: (pages[1]?.left ?? 0) + 5, t: p0.top + 10, w: 20, h: 40 };
    const parts = partsOf(covered, pages);
    expect(isPartsError(parts) ? [] : parts.map((q) => q.page)).toEqual([0]);
  });
  test("mép dưới: đè lên các dải đáy ⇒ giáp lai nhiều trang", () => {
    const bp = layoutFan(sizes(5), W, "bottom", 0).pages;
    const b0 = bp[0];
    if (!b0) throw new Error("thiếu trang");
    const r = { l: b0.left + 30, t: b0.top + b0.height - 20, w: 120, h: 4 * FAN_PX + 20 };
    const parts = partsOf(r, bp);
    expect(isPartsError(parts) ? [] : parts.map((q) => q.page)).toEqual([0, 1, 2, 3, 4]);
  });
  test("rectFromParts dựng lại khung đầy đủ từ phần đầu (khứ hồi)", () => {
    const r = { l: p0.left + p0.width - 20, t: p0.top + 100, w: 100, h: 50 };
    const parts = partsOf(r, pages);
    if (isPartsError(parts)) throw new Error("lỗi");
    const back = rectFromParts(parts, pages);
    expect(Math.round(back?.l ?? 0)).toBe(Math.round(r.l));
    expect(Math.round(back?.t ?? 0)).toBe(Math.round(r.t));
    expect(last?.index).toBe(4);
  });
});

describe("kiểu xem của chữ ký", () => {
  const mk = (over: Partial<SignItem>): SignItem => ({
    id: "a",
    kind: "mark",
    parts: [],
    aspect: 2,
    status: "editable",
    ...over,
  });
  test("viewKey: page / fan-<mép>-<nhóm>; «Liền mép» không đổi khoá", () => {
    expect(viewKey(DEFAULT_VIEW)).toBe("page");
    expect(viewKey({ ...DEFAULT_VIEW, lien: true })).toBe("page");
    expect(viewKey({ ...DEFAULT_VIEW, mode: "fan", edge: "bottom", group: 2 })).toBe(
      "fan-bottom-2",
    );
  });
  test("chỉ kéo được khi đúng kiểu xem đã đặt; không có view ⇒ «page»; đã ký thì không", () => {
    expect(editableIn(mk({}), "page")).toBe(true);
    expect(editableIn(mk({}), "fan-right-0")).toBe(false);
    expect(editableIn(mk({ view: "fan-right-0" }), "fan-right-0")).toBe(true);
    expect(editableIn(mk({ view: "fan-right-0" }), "fan-right-1")).toBe(false);
    expect(editableIn(mk({ view: "fan-right-0" }), "page")).toBe(false);
    expect(editableIn(mk({ status: "mine" }), "page")).toBe(false);
  });
  test("đổi «Liền mép»: tính lại phần cắt của chữ ký «page», chữ ký kiểu xem khác giữ nguyên", () => {
    const gap = layoutView(sizes(2), W, DEFAULT_VIEW).pages;
    const flush = layoutView(sizes(2), W, { ...DEFAULT_VIEW, lien: true }).pages;
    const g1 = gap[1];
    const g0 = gap[0];
    if (!g0 || !g1) throw new Error("thiếu trang");
    const r = { l: g0.left + 20, t: g1.top - 30, w: 120, h: 50 };
    const parts = partsOf(r, gap);
    if (isPartsError(parts)) throw new Error("lỗi");
    const mine = mk({ id: "p", parts });
    const other = mk({ id: "f", parts, view: "fan-right-0" });
    const out = relayoutItems([mine, other], "page", gap, flush);
    expect(out[0]?.parts).not.toEqual(parts);
    expect(out[1]).toBe(other);
    expect(relayoutItems([other], "page", gap, flush)).toEqual([other]);
  });
});
