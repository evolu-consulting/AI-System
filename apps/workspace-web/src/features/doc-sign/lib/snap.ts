// CR-181 · hít vào khe giữa hai trang (chế độ «Từng trang»). Bản mẫu dòng 650–658.
import type { Rect, StagePage } from "./geometry";

export const SNAP_PX = 16;

/** Khe ngang giữa hai trang liền nhau: `at` = toạ độ y giữa khe; (l,w) để vẽ vạch tím. */
export type Seam = { at: number; l: number; w: number };
export type SnapResult = { rect: Rect; seam: Seam | null };

export function seamsOf(pages: StagePage[]): Seam[] {
  const out: Seam[] = [];
  for (let i = 0; i < pages.length - 1; i++) {
    const a = pages[i];
    const b = pages[i + 1];
    if (!a || !b) continue;
    out.push({ at: (a.top + a.height + b.top) / 2, l: a.left, w: a.width });
  }
  return out;
}

/** Tâm chữ ký cách khe < 16px ⇒ dời để tâm trùng khe. Chỉ hít khe đầu tiên khớp. */
export function snapToSeams(r: Rect, seams: Seam[], threshold = SNAP_PX): SnapResult {
  const c = r.t + r.h / 2;
  for (const s of seams) {
    if (Math.abs(c - s.at) < threshold) return { rect: { ...r, t: s.at - r.h / 2 }, seam: s };
  }
  return { rect: r, seam: null };
}
