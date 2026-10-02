// ADM-FR-35 · plan-frontend §3.3 · theo dõi cuộn/kích thước vùng lưới và trả về khoảng hàng/cột cần dựng (cửa sổ hoá hai chiều).
import { useCallback, useEffect, useRef, useState } from "react";
import { type Box, GRID, windowRanges } from "../lib/grid-window";

const INITIAL: Box = { left: 0, top: 0, width: 1200, height: 600 };

export function useGridWindow(rowCount: number, colCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(INITIAL);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setBox({
      left: el.scrollLeft,
      top: el.scrollTop,
      width: el.clientWidth,
      height: el.clientHeight,
    });
  }, []);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [measure]);

  const { rows, cols } = windowRanges(box, rowCount, colCount);
  return {
    ref,
    onScroll,
    rows,
    cols,
    totalW: GRID.labelW + colCount * GRID.colW,
    totalH: GRID.headH + rowCount * GRID.rowH,
  };
}
