// CR-125 · x4 · node KHÔNG BAO GIỜ chồng nhau: vị trí cuối = vị trí tay (đã lưu) CHỈ KHI không đè node nào; đè ⇒ quay về toạ độ ELK của node đó.
// Còn đè (ELK dự phòng, node chưa có toạ độ ELK…) ⇒ đẩy node sau xuống dưới. Hàm thuần: không phụ thuộc xyflow, test không cần trình duyệt.
import { NODE_H, NODE_W } from "./geometry";

type Pt = { x: number; y: number };
export type SettleItem = {
  id: string;
  /** Vị trí người dùng kéo/thả (đã lưu). */
  manual?: Pt | null;
  /** Toạ độ ELK. */
  auto?: Pt | null;
  /** Kích thước thật của hộp (mặc định `NODE_W` × `NODE_H`). */
  w?: number;
  h?: number;
};

/** Khoảng trống tối thiểu giữa hai hộp (px): đủ chỗ cho mũi tên đi giữa và nút "+" trên cạnh. */
export const SETTLE_GAP = 24;

type Box = Pt & { w: number; h: number };
const boxAt = (p: Pt, it: SettleItem): Box => ({
  x: p.x,
  y: p.y,
  w: it.w ?? NODE_W,
  h: it.h ?? NODE_H,
});

/** Hai hộp có đè nhau (kể cả khoảng `gap`) không. */
export const overlaps = (a: Box, b: Box, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Hộp `p` đặt cho node `id` có đè node nào trong `others` (toạ độ hiện tại) không. */
export function collidesWith(
  at: Pt,
  id: string,
  items: readonly SettleItem[],
  ...[pos, gap = SETTLE_GAP]: [pos: ReadonlyMap<string, Pt>, gap?: number]
): boolean {
  const me = items.find((i) => i.id === id);
  const box = boxAt(at, me ?? { id });
  return items.some((o) => {
    const p = o.id === id ? null : pos.get(o.id);
    return p ? overlaps(box, boxAt(p, o), gap) : false;
  });
}

/** Hai node đè nhau ⇒ đẩy một node xuống dưới node kia (ưu tiên đẩy node không cố định, rồi node sau); trả về true nếu có đẩy. */
function pushApart(
  a: SettleItem,
  b: SettleItem,
  pos: Map<string, Pt>,
  fixed: ReadonlySet<string>,
): boolean {
  const [pa, pb] = [pos.get(a.id) as Pt, pos.get(b.id) as Pt];
  if (!overlaps(boxAt(pa, a), boxAt(pb, b), SETTLE_GAP)) return false;
  const [mover, stay] = fixed.has(b.id) && !fixed.has(a.id) ? [a, b] : [b, a];
  const ps = pos.get(stay.id) as Pt;
  pos.set(mover.id, { x: (pos.get(mover.id) as Pt).x, y: ps.y + (stay.h ?? NODE_H) + SETTLE_GAP });
  return true;
}

/** Đẩy xuống từng node đè (thứ tự trên → dưới, trái → phải) cho tới khi hết đè; node có vị trí tay chỉ bị đẩy khi không còn lựa chọn khác. */
function separate(
  items: readonly SettleItem[],
  pos: Map<string, Pt>,
  fixed: ReadonlySet<string>,
): void {
  const order = [...items].filter((i) => pos.has(i.id));
  order.sort(
    (a, b) =>
      (pos.get(a.id)?.y ?? 0) - (pos.get(b.id)?.y ?? 0) ||
      (pos.get(a.id)?.x ?? 0) - (pos.get(b.id)?.x ?? 0),
  );
  for (let pass = 0; pass < order.length + 1; pass++) {
    const pairs = order.flatMap((a, i) => order.slice(i + 1).map((b) => [a, b] as const));
    if (!pairs.map(([a, b]) => pushApart(a, b, pos, fixed)).some(Boolean)) return;
  }
}
/**
 * Vị trí cuối của mọi node: ELK cho node chưa kéo; node đã kéo giữ vị trí tay nếu không đè ai, đè ⇒ về toạ độ ELK (bố cục lại).
 * Node không có cả hai toạ độ ⇒ chưa hiện (vắng trong kết quả). Kết quả không có hai hộp nào giao nhau (cách nhau ≥ `SETTLE_GAP`).
 */
export function settlePositions(items: readonly SettleItem[]): Map<string, Pt> {
  const pos = new Map<string, Pt>();
  for (const it of items) if (it.auto) pos.set(it.id, it.auto);
  const kept = new Set<string>();
  for (const it of items) {
    if (!it.manual) continue;
    if (!collidesWith(it.manual, it.id, items, pos)) {
      pos.set(it.id, it.manual);
      kept.add(it.id);
    } else if (!it.auto) pos.delete(it.id); // chưa có toạ độ ELK để quay về ⇒ chờ lượt bố cục
  }
  separate(items, pos, kept);
  return pos;
}
