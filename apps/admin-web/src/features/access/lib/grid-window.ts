// ADM-FR-35 · plan-frontend §3.3 · cửa sổ hoá lưới ma trận (hàm thuần): chỉ dựng hàng/cột đang nhìn thấy (+ overscan).
export const GRID = { rowH: 52, colW: 120, labelW: 300, headH: 64, overscan: 3 } as const;

export type Range = { start: number; end: number };
export type Box = { left: number; top: number; width: number; height: number };

/** Chỉ số `[start, end)` của các mục (cao/rộng `size`) giao với đoạn nhìn thấy `[scroll, scroll + viewport)`, mở thêm `overscan`. */
export function visibleRange(a: {
  scroll: number;
  viewport: number;
  size: number;
  count: number;
  overscan?: number;
}): Range {
  const overscan = a.overscan ?? GRID.overscan;
  if (a.count <= 0 || a.size <= 0) return { start: 0, end: 0 };
  const from = Math.max(0, a.scroll);
  const first = Math.floor(from / a.size);
  const last = Math.ceil((from + Math.max(0, a.viewport)) / a.size);
  return { start: Math.max(0, first - overscan), end: Math.min(a.count, last + overscan) };
}

/** Khoảng hàng và cột cần dựng cho vùng cuộn `box` (trừ cột nhãn dính trái và hàng tiêu đề dính trên). */
export function windowRanges(
  box: Box,
  rowCount: number,
  colCount: number,
): { rows: Range; cols: Range } {
  return {
    rows: visibleRange({
      scroll: box.top,
      viewport: box.height - GRID.headH,
      size: GRID.rowH,
      count: rowCount,
    }),
    cols: visibleRange({
      scroll: box.left,
      viewport: box.width - GRID.labelW,
      size: GRID.colW,
      count: colCount,
    }),
  };
}
