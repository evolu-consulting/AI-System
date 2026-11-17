// CR-181 · hình học ký phía máy chủ (decisions §4, BR-L3/L4) — hàm thuần.
// Toạ độ vào: điểm PDF, gốc DƯỚI-TRÁI của trang ĐÃ XOAY như hiển thị (pdf.js viewport scale 1).
// Toạ độ ra: ma trận `cm` đưa «hệ hiển thị» về hệ gốc của trang (theo /Rotate + CropBox lệch gốc).
import { SIGN_SEAM_PAGES_MAX, type SignPart } from "@ai/contracts/pack-contracts";
import { SignError } from "./sign-error";

/** Hộp nhìn thấy của một trang CHƯA xoay (CropBox ∩ MediaBox, có thể lệch gốc) + /Rotate. */
export type PageView = { x: number; y: number; width: number; height: number; rotate: number };
/** [a b c d e f] của PDF: x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];
/** Một phần đã kiểm: `clip` đã giao với trang (hệ hiển thị). */
export type ResolvedPart = {
  page: number;
  frame: { x: number; y: number; w: number; h: number };
  clip: { x: number; y: number; w: number; h: number };
};

/** /Rotate về {0,90,180,270}; giá trị lạ ⇒ lỗi. */
export function normRotate(r: number): 0 | 90 | 180 | 270 {
  const n = (((Math.round(r) % 360) + 360) % 360) as number;
  if (n === 0 || n === 90 || n === 180 || n === 270) return n;
  throw new SignError("SIGN_PDF_INVALID", `Rotate=${r}`);
}

/** Cỡ trang như hiển thị (90/270 đổi chỗ rộng ↔ cao). */
export function displaySize(v: PageView): { w: number; h: number } {
  const r = normRotate(v.rotate);
  return r === 90 || r === 270 ? { w: v.height, h: v.width } : { w: v.width, h: v.height };
}

/** Ma trận hiển thị → hệ gốc của trang (đã cộng độ lệch gốc của hộp). */
export function displayToUser(v: PageView): Matrix {
  const { x: bx, y: by, width: W, height: H } = v;
  switch (normRotate(v.rotate)) {
    case 0:
      return [1, 0, 0, 1, bx, by];
    case 90:
      return [0, 1, -1, 0, bx + W, by];
    case 180:
      return [-1, 0, 0, -1, bx + W, by + H];
    case 270:
      return [0, -1, 1, 0, bx, by + H];
  }
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Kiểm parts với danh sách trang thật của tệp, giao phần cắt với trang (BR-L3).
 * Phần không còn gì trong trang bị bỏ; không còn phần nào ⇒ `SIGN_OUTSIDE_PAGE`.
 */
export function resolveParts(
  parts: readonly SignPart[],
  pages: readonly PageView[],
): ResolvedPart[] {
  if (parts.length < 1 || parts.length > SIGN_SEAM_PAGES_MAX)
    throw new SignError("SIGN_PARTS_INVALID", `số phần ${parts.length}`);
  const out: ResolvedPart[] = [];
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    if (prev && p.page !== prev.page + 1)
      throw new SignError("SIGN_PARTS_INVALID", "trang không liên tiếp");
    const pg = pages[p.page];
    if (!pg) throw new SignError("SIGN_PAGE_NOT_FOUND", `trang ${p.page}`);
    const { w: pw, h: ph } = displaySize(pg);
    const x0 = Math.max(p.cx, 0);
    const y0 = Math.max(p.cy, 0);
    const x1 = Math.min(p.cx + p.cw, pw);
    const y1 = Math.min(p.cy + p.ch, ph);
    if (x1 <= x0 || y1 <= y0) return;
    out.push({
      page: p.page,
      frame: { x: p.x, y: p.y, w: p.w, h: p.h },
      clip: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    });
  });
  if (out.length === 0) throw new SignError("SIGN_OUTSIDE_PAGE");
  return out;
}
