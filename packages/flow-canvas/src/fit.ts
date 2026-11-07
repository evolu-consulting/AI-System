// CR-125 · x11 · MỘT luật "vừa khung" cho mọi canvas sơ đồ (mở lần đầu, nút "vừa khung", "Sắp xếp", khung đổi cỡ, mọi trình sửa): CẢ flow nằm trọn trong vùng
// thấy được (khung trừ ngăn chi tiết) — kể cả cột Kết thúc ở cuối — bằng cách thu nhỏ tới mức cần (chỉ dừng ở mức zoom tối thiểu của canvas). Không còn "sàn đọc được"
// làm cắt đuôi flow; flow quá lớn so với mức tối thiểu mới neo mép trái/trên. Hàm thuần (test không cần trình duyệt).
export type FitBounds = { x: number; y: number; w: number; h: number };
export type FitView = { x: number; y: number; zoom: number };
export type FitOptions = {
  /** Kích thước khung canvas (px). */
  size: { w: number; h: number };
  /** Bề rộng ngăn chi tiết đang đè bên phải (px), 0 = không. */
  inset?: number;
  /** Phần chừa mỗi phía theo tỉ lệ vùng thấy được (mặc định 0.08). */
  padding?: number;
  /** Zoom lớn nhất (không phóng to quá cỡ thật). */
  maxZoom?: number;
  /** Zoom nhỏ nhất của canvas — chỉ chạm tới khi flow thật sự không vừa. */
  minZoom: number;
};

/** Mép chừa khi neo trái/trên (flow không vừa ở mức zoom tối thiểu). */
const ANCHOR_MARGIN = 16;

/** Khung nhìn đưa `bounds` (toạ độ sơ đồ) vào TRỌN vùng thấy được. */
export function fitViewport(bounds: FitBounds, o: FitOptions): FitView {
  const availW = Math.max(o.size.w - (o.inset ?? 0), 200);
  const availH = Math.max(o.size.h, 100);
  const pad = o.padding ?? 0.08;
  const maxZoom = o.maxZoom ?? 1;
  const fitW = (availW * (1 - 2 * pad)) / Math.max(bounds.w, 1);
  const fitH = (availH * (1 - 2 * pad)) / Math.max(bounds.h, 1);
  const want = Math.min(fitW, fitH, maxZoom);
  const zoom = Math.max(want, o.minZoom);
  if (want < o.minZoom)
    // không vừa ngay cả ở mức tối thiểu: neo mép trái/trên, phần còn lại kéo để xem
    return {
      x: ANCHOR_MARGIN - bounds.x * zoom,
      y: ANCHOR_MARGIN - bounds.y * zoom,
      zoom,
    };
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { x: availW / 2 - cx * zoom, y: availH / 2 - cy * zoom, zoom };
}

/** Hộp `b` (toạ độ sơ đồ) sau khi áp khung nhìn `v`, có nằm trọn trong vùng thấy được không. */
export function insideView(
  b: FitBounds,
  v: FitView,
  o: Pick<FitOptions, "size" | "inset">,
): boolean {
  const availW = o.size.w - (o.inset ?? 0);
  const left = b.x * v.zoom + v.x;
  const top = b.y * v.zoom + v.y;
  return (
    left >= -0.5 &&
    top >= -0.5 &&
    left + b.w * v.zoom <= availW + 0.5 &&
    top + b.h * v.zoom <= o.size.h + 0.5
  );
}
