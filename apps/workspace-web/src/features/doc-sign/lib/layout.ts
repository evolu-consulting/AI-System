// CR-181 · bố cục «Từng trang»: xếp các trang theo chiều dọc, canh giữa, bề rộng tối đa theo sân khấu.
import type { StagePage } from "./geometry";

export type PageSize = { ptWidth: number; ptHeight: number };
export const STAGE_PAD = 16;
export const PAGE_GAP = 16;
export const PAGE_MAX_W = 820;

export function layoutPages(sizes: PageSize[], containerWidth: number) {
  const width = Math.max(120, Math.min(PAGE_MAX_W, containerWidth - STAGE_PAD * 2));
  const left = Math.max(0, (containerWidth - width) / 2);
  let top = STAGE_PAD;
  const pages: StagePage[] = sizes.map((s, index) => {
    const height = (width * s.ptHeight) / s.ptWidth;
    const p = { index, left, top, width, height, ptWidth: s.ptWidth, ptHeight: s.ptHeight };
    top += height + PAGE_GAP;
    return p;
  });
  return { pages, width: containerWidth, height: top - PAGE_GAP + STAGE_PAD };
}

/** Trang chứa điểm y (hoặc gần nhất) — để gán chữ ký thả vào khe. */
export function pageAt(pages: StagePage[], y: number): StagePage | undefined {
  return pages.find((p) => y >= p.top && y <= p.top + p.height) ?? pages.at(-1);
}
