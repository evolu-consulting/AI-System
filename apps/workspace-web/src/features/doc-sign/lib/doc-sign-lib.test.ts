import { describe, expect, test } from "bun:test";
import { SIGN_INITIALS_SCALE } from "@ai/contracts/pack-contracts";
import { clampToStage, copyToAllPages, labelFor, nudge, resizeKeepAspect } from "./actions";
import { findAnchors } from "./anchors";
import {
  isPartsError,
  partsOf,
  type Rect,
  rectFromParts,
  type StagePage,
  toN,
  toPx,
} from "./geometry";
import { seamsOf, snapToSeams } from "./snap";

// trang A4 595x842pt hiển thị 500px rộng (k = 1,19), xếp dọc, khe 20px
const W = 500;
const H = (842 / 595) * W;
const mk = (n: number): StagePage[] =>
  Array.from({ length: n }, (_, i) => ({
    index: i,
    left: 40,
    top: 20 + i * (H + 20),
    width: W,
    height: H,
    ptWidth: 595,
    ptHeight: 842,
  }));

describe("partsOf / rectFromParts", () => {
  test("khứ hồi px↔điểm sai số < 0,5pt", () => {
    const pages = mk(3);
    const r: Rect = { l: 100, t: 300, w: 170, h: 70 };
    const parts = partsOf(r, pages);
    if (isPartsError(parts)) throw new Error("unexpected");
    expect(parts).toHaveLength(1);
    const back = rectFromParts(parts, pages);
    expect(back).not.toBeNull();
    const k = 595 / W;
    expect(Math.abs((back?.l ?? 0) - r.l) * k).toBeLessThan(0.5);
    expect(Math.abs((back?.t ?? 0) - r.t) * k).toBeLessThan(0.5);
    expect(Math.abs((back?.w ?? 0) - r.w) * k).toBeLessThan(0.5);
    expect(Math.abs((back?.h ?? 0) - r.h) * k).toBeLessThan(0.5);
  });

  test("lật trục y: sát đáy trang ⇒ y ≈ 0", () => {
    const pages = mk(1);
    const p0 = pages[0] as StagePage;
    const parts = partsOf({ l: 50, t: p0.top + H - 50, w: 100, h: 50 }, pages);
    if (isPartsError(parts)) throw new Error("unexpected");
    expect(parts[0]?.y).toBeCloseTo(0, 5);
  });

  test("giáp lai qua khe ⇒ 2 phần, cắt đúng theo trang", () => {
    const pages = mk(3);
    const p0 = pages[0] as StagePage;
    const seam = p0.top + H + 10;
    const parts = partsOf({ l: 100, t: seam - 35, w: 170, h: 70 }, pages);
    if (isPartsError(parts)) throw new Error("unexpected");
    expect(parts.map((p) => p.page)).toEqual([0, 1]);
    const [a, b] = parts;
    expect(a?.cy).toBeCloseTo(0, 5); // chạm đáy trang 0
    expect((b?.cy ?? 0) + (b?.ch ?? 0)).toBeCloseTo(842, 5); // chạm đỉnh trang 1
    expect(a?.x).toBeCloseTo(b?.x ?? -1, 5);
    expect(a?.w).toBeCloseTo(b?.w ?? -1, 5);
  });

  test("vượt 5 trang ⇒ lỗi", () => {
    const pages = mk(7);
    const last = pages[6] as StagePage;
    const r = partsOf({ l: 100, t: 30, w: 170, h: last.top + last.height }, pages);
    expect(isPartsError(r) && r.error).toBe("too_many_pages");
  });

  test("toN/toPx khứ hồi và co theo cỡ trang đầu", () => {
    const pages = mk(2);
    const r: Rect = { l: 120, t: 200, w: 160, h: 160 / 2.4 };
    const n = toN(r, pages);
    const back = toPx(n, 2.4, pages);
    expect(back.l).toBeCloseTo(r.l, 6);
    expect(back.h).toBeCloseTo(r.h, 6);
    const half = pages.map((p) => ({ ...p, left: 0, top: p.top / 2, width: W / 2, height: H / 2 }));
    expect(toPx(n, 2.4, half).w).toBeCloseTo(r.w / 2, 6);
  });
});

describe("snap", () => {
  const pages = mk(2);
  const seams = seamsOf(pages);
  const at = (seams[0] as { at: number }).at;
  test("trong 16px ⇒ hít, tâm trùng khe", () => {
    const res = snapToSeams({ l: 100, t: at - 35 + 10, w: 170, h: 70 }, seams);
    expect(res.seam).not.toBeNull();
    expect(res.rect.t + res.rect.h / 2).toBeCloseTo(at, 6);
  });
  test("ngoài 16px ⇒ giữ nguyên", () => {
    const r = { l: 100, t: at - 35 + 16, w: 170, h: 70 };
    const res = snapToSeams(r, seams);
    expect(res.seam).toBeNull();
    expect(res.rect).toEqual(r);
  });
});

describe("actions", () => {
  test("nudge 4px", () => {
    expect(nudge({ l: 10, t: 10, w: 5, h: 5 }, "ArrowLeft").l).toBe(6);
    expect(nudge({ l: 10, t: 10, w: 5, h: 5 }, "ArrowDown").t).toBe(14);
  });
  test("resize giữ tỉ lệ, tối thiểu 30px, neo góc đối diện", () => {
    const s: Rect = { l: 100, t: 100, w: 120, h: 50 };
    const se = resizeKeepAspect(s, "se", 60, 2.4);
    expect(se.w).toBe(180);
    expect(se.w / se.h).toBeCloseTo(2.4, 6);
    expect(se.l).toBe(100);
    const nw = resizeKeepAspect(s, "nw", -60, 2.4);
    expect(nw.l + nw.w).toBeCloseTo(220, 6);
    expect(nw.t + nw.h).toBeCloseTo(150, 6);
    expect(resizeKeepAspect(s, "se", -500, 2.4).w).toBe(30);
  });
  test("chép sang mọi trang bỏ trang nguồn, cỡ 0,4, tâm giữ vị trí tương đối", () => {
    const pages = mk(3);
    const p1 = pages[1] as StagePage;
    const r: Rect = { l: 300, t: p1.top + 100, w: 170, h: 70 };
    const out = copyToAllPages(r, 1, pages, SIGN_INITIALS_SCALE);
    expect(out.map((o) => o.page)).toEqual([0, 2]);
    for (const o of out) {
      const pg = pages[o.page] as StagePage;
      expect(o.rect.w).toBeCloseTo(68, 6);
      expect(o.rect.l + o.rect.w / 2).toBeCloseTo(300 + 85, 6);
      expect(o.rect.t + o.rect.h / 2).toBeCloseTo(pg.top + 100 + 35, 6);
    }
    expect(copyToAllPages(r, 1, pages, 1)[0]?.rect.w).toBe(170);
  });
  test("labelFor", () => {
    expect(labelFor([{ page: 2 }])).toBe("Trang 3");
    expect(labelFor([{ page: 2 }, { page: 3 }])).toBe("Giáp lai 2 trang: 3, 4");
    expect(labelFor([])).toBe("Kéo vào trang");
  });
  test("clampToStage", () => {
    const st = { width: 600, height: 800 };
    expect(clampToStage({ l: -5, t: 900, w: 100, h: 50 }, st)).toEqual({
      l: 0,
      t: 750,
      w: 100,
      h: 50,
    });
  });
});

describe("findAnchors", () => {
  const item = (str: string, x = 100, y = 200) => ({ str, transform: [1, 0, 0, 1, x, y] });
  test("cụm bị tách thành nhiều item liền nhau, không phân biệt hoa thường", () => {
    const a = findAnchors([
      {
        page: 0,
        items: [item("Đại diện "), item("bên", 150), item("A", 190), item("ĐẠI DIỆN BÊN B", 300)],
      },
    ]);
    expect(a.A?.page).toBe(0);
    expect(a.A?.x).toBeCloseTo(100 + 75 - 80, 6);
    expect(a.A?.w).toBe(160);
    expect((a.A?.w ?? 0) / (a.A?.h ?? 1)).toBeCloseTo(2.4, 6);
    expect(a.A?.y).toBeCloseTo(200 - 45 - 160 / 2.4 / 2, 6);
    expect(a.B?.x).toBeCloseTo(300 - 5, 6);
  });
  test("NFC: chuỗi tổ hợp vẫn khớp", () => {
    const a = findAnchors([{ page: 0, items: [item("ĐẠI DIỆN BÊN A".normalize("NFD"))] }]);
    expect(a.A).not.toBeNull();
  });
  test("không có cụm ⇒ null", () => {
    expect(findAnchors([{ page: 0, items: [item("Điều 1")] }])).toEqual({ A: null, B: null });
  });
  test("trang cuối được ưu tiên", () => {
    const a = findAnchors([
      { page: 0, items: [item("ĐẠI DIỆN BÊN A", 10, 10)] },
      { page: 2, items: [item("ĐẠI DIỆN BÊN A", 50, 60)] },
      { page: 1, items: [item("ĐẠI DIỆN BÊN B", 70, 80)] },
    ]);
    expect(a.A?.page).toBe(2);
    expect(a.B?.page).toBe(1);
  });
});
