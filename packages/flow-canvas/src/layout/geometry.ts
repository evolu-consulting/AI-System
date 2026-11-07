// CR-123 · u13 · kích thước node trên canvas (một nguồn cho bố cục ELK, node, fit) + độ dịch để node không nằm dưới ngăn chi tiết.
export const NODE_W = 240;
export const NODE_H = 104;

/**
 * fnr-editor-drawer: độ dịch ngang (px màn hình) để node [left, right] không nằm dưới ngăn chi tiết rộng `inset` đè mép phải
 * khung rộng `width` (chừa lề 16); 0 nếu đã thấy được.
 */
export function revealDx(left: number, right: number, width: number, inset: number): number {
  const limit = width - inset - 16;
  if (right > limit) return limit - right;
  return left < 16 ? 16 - left : 0;
}
