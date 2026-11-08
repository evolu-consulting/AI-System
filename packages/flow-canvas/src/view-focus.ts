// CR-123 · u14 · khung nhìn "đi theo việc đang làm": sau khi thả / nối / bố cục lại, node mới + node vừa nối phải nằm TRỌN trong khung.
// Hàm thuần: nhận hộp (toạ độ sơ đồ) của các node cần thấy + khung nhìn hiện tại ⇒ khung nhìn đích, hoặc null nếu đã thấy đủ (không dịch chuyển thừa).
// Zoom không bao giờ dưới `minZoom` (chữ đọc được) và không bao giờ phóng to thêm; không vừa ở `minZoom` ⇒ chỉ cần thấy trọn node ĐẦU (node mới).
export type FocusBox = { x: number; y: number; w: number; h: number };
export type FocusVp = { x: number; y: number; zoom: number };

const union = (bs: readonly FocusBox[]): FocusBox => {
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export function focusViewport(
  boxes: readonly FocusBox[],
  vp: FocusVp,
  size: { w: number; h: number },
  ...[inset, minZoom, margin = 24]: [inset: number, minZoom: number, margin?: number]
): FocusVp | null {
  if (boxes.length === 0) return null;
  const availW = size.w - inset - 2 * margin;
  const availH = size.h - 2 * margin;
  const fits = (b: FocusBox) => Math.min(availW / b.w, availH / b.h);
  let b = union(boxes);
  let z = Math.max(vp.zoom, minZoom);
  if (fits(b) < z) {
    if (fits(b) >= minZoom) z = fits(b);
    else {
      b = boxes[0] as FocusBox; // không vừa ở mức đọc được ⇒ chỉ giữ node mới (đầu danh sách) trọn khung
      z = Math.min(z, Math.max(minZoom, fits(b)));
    }
  }
  const sx = b.x * z + vp.x;
  const sy = b.y * z + vp.y;
  const inside =
    z === vp.zoom &&
    sx >= margin - 0.5 &&
    sy >= margin - 0.5 &&
    sx + b.w * z <= size.w - inset - margin + 0.5 &&
    sy + b.h * z <= size.h - margin + 0.5;
  if (inside) return null;
  return {
    x: margin + (availW - b.w * z) / 2 - b.x * z,
    y: margin + (availH - b.h * z) / 2 - b.y * z,
    zoom: z,
  };
}

/**
 * CR-125 · x4 · nhóm node cần thấy cùng lúc khi ngăn chi tiết mở: `boxes[0]` = node chính, còn lại xếp từ gần tới xa.
 * Bỏ dần node xa nhất tới khi cả nhóm vừa vùng thấy được (khung trừ ngăn) ở zoom ≥ `floor`; node chính luôn được giữ.
 */
export function fitGroup(
  boxes: readonly FocusBox[],
  size: { w: number; h: number },
  ...[inset, floor, margin = 24]: [inset: number, floor: number, margin?: number]
): FocusBox[] {
  const availW = size.w - inset - 2 * margin;
  const availH = size.h - 2 * margin;
  const use = [...boxes];
  while (use.length > 1) {
    const u = union(use);
    if (Math.min(availW / u.w, availH / u.h) >= floor) break;
    use.pop();
  }
  return use;
}
