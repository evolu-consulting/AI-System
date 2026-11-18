// CR-181 · hình học chữ ký trên tài liệu — thuần, không DOM. Bản mẫu: prototype.html dòng 629–660.
import { SIGN_SEAM_PAGES_MAX, type SignPart } from "@ai/contracts/pack-contracts";

/** Hình chữ nhật px trên sân khấu. */
export type Rect = { l: number; t: number; w: number; h: number };
/** Toạ độ chuẩn hoá theo bề rộng trang ĐẦU (chịu đổi cỡ cửa sổ). */
export type NormRect = { l: number; t: number; w: number };
/** Trang hiển thị: px trên sân khấu + kích thước điểm của trang ĐÃ XOAY (pdf.js viewport scale 1). */
export type StagePage = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  ptWidth: number;
  ptHeight: number;
  /** Xoè quạt: phần ĐANG LỘ của trang (px). Không có ⇒ lộ cả trang. */
  visible?: Rect;
};
export type PartsError = { error: "too_many_pages" };
export type PartsResult = SignPart[] | PartsError;

export const isPartsError = (r: PartsResult): r is PartsError => !Array.isArray(r);

const MIN_OVERLAP_PX = 1;

/** Đổi rect px → các phần theo điểm PDF (gốc dưới-trái), cắt theo phần đang lộ của từng trang, chỉ trang giao ≥ 1px. Toạ độ x,y,w,h vẫn quy về trang ĐẦY ĐỦ. */
export function partsOf(r: Rect, pages: StagePage[]): PartsResult {
  const out: SignPart[] = [];
  for (const p of pages) {
    const v = p.visible ?? { l: p.left, t: p.top, w: p.width, h: p.height };
    const il = Math.max(r.l, v.l);
    const it = Math.max(r.t, v.t);
    const ir = Math.min(r.l + r.w, v.l + v.w);
    const ib = Math.min(r.t + r.h, v.t + v.h);
    if (ir - il < MIN_OVERLAP_PX || ib - it < MIN_OVERLAP_PX) continue;
    const k = p.ptWidth / p.width;
    out.push({
      page: p.index,
      x: (r.l - p.left) * k,
      y: p.ptHeight - (r.t - p.top + r.h) * k,
      w: r.w * k,
      h: r.h * k,
      cx: (il - p.left) * k,
      cy: p.ptHeight - (ib - p.top) * k,
      cw: (ir - il) * k,
      ch: (ib - it) * k,
    });
  }
  out.sort((a, b) => a.page - b.page);
  if (out.length > SIGN_SEAM_PAGES_MAX) return { error: "too_many_pages" };
  return out;
}

/** Ngược lại: dựng rect px (khung cả chữ ký) từ phần đầu. null nếu trang không còn hiển thị. */
export function rectFromParts(parts: SignPart[], pages: StagePage[]): Rect | null {
  const q = parts[0];
  if (!q) return null;
  const p = pages.find((x) => x.index === q.page);
  if (!p) return null;
  const k = p.width / p.ptWidth;
  return { l: p.left + q.x * k, t: p.top + (p.ptHeight - q.y - q.h) * k, w: q.w * k, h: q.h * k };
}

/** px → chuẩn hoá theo trang đầu (bản mẫu `toN`). */
export function toN(r: Rect, pages: StagePage[]): NormRect {
  const b = pages[0];
  if (!b) return { l: 0, t: 0, w: 0.2 };
  return { l: (r.l - b.left) / b.width, t: (r.t - b.top) / b.width, w: r.w / b.width };
}

/** chuẩn hoá → px, cần tỉ lệ rộng:cao (bản mẫu `toPx`). */
export function toPx(n: NormRect, aspect: number, pages: StagePage[]): Rect {
  const b = pages[0];
  if (!b) return { l: 0, t: 0, w: 0, h: 0 };
  const w = n.w * b.width;
  return { l: b.left + n.l * b.width, t: b.top + n.t * b.width, w, h: w / aspect };
}
