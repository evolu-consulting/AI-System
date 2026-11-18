// CR-182 · fix-cr182-ui · lỗi 4: sơ đồ quy trình ở Cài đặt phải đọc được (chữ ≥ 12px = zoom 1), không ép vừa khung.
// Luật «vừa khung» của gói flow-canvas chỉ thu nhỏ khi sơ đồ lớn hơn khung ⇒ cho khung CHỨA ĐỦ sơ đồ ở zoom 1 (và cuộn trong vùng bao ngoài).
type Box = { position: { x: number; y: number }; width?: number | null; height?: number | null };

/** Chừa mép của luật vừa khung (`FIT.padding` = 0.08 của @ai/flow-canvas, không import để file này không kéo xyflow): vùng thấy được = sơ đồ / 0.84. */
const VISIBLE = 1 - 2 * 0.08;

/** Cỡ tối thiểu (px) của khung canvas để cả sơ đồ nằm trọn ở zoom 1. */
export function flowBox(nodes: readonly Box[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 0, height: 0 };
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const w = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0))) - Math.min(...xs);
  const h = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0))) - Math.min(...ys);
  return { width: Math.ceil(w / VISIBLE) + 4, height: Math.ceil(h / VISIBLE) + 4 };
}
