// CR-125 · x9 · định tuyến cạnh vuông góc NÉ node: cạnh bắt đầu ĐÚNG ở chấm đầu ra (đúng mép), không cắt hộp node nào (kể cả node nguồn / đích của chính nó),
// kể cả khi node đã bị kéo tay (ELK chưa biết). Thuần (không React / xyflow): lưới Hanan quanh hộp node (nở thêm `margin`) + Dijkstra có phạt khúc rẽ.
// Đầu vào lấy từ chính toạ độ chấm xyflow đưa cho cạnh (`sourceX/Y`, `targetX/Y` + mép), nên đường luôn khớp chấm trên màn hình.
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = "left" | "right" | "top" | "bottom";

export type RouteIn = {
  from: Pt;
  fromSide: Side;
  to: Pt;
  toSide: Side;
  boxes: readonly Rect[];
  /** Khoảng cách tối thiểu từ đường tới hộp node (px). */
  margin?: number;
  /** Đoạn thẳng đầu/cuối rời/vào chấm theo mép (px) trước khi được phép rẽ. */
  stub?: number;
};

const OUT: Record<Side, Pt> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
// hướng đi trên lưới: 0 phải, 1 trái, 2 xuống, 3 lên
const DIRS: readonly Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const OPP = [1, 0, 3, 2] as const;
const BEND = 48;

const dirOfSide = (s: Side): number => DIRS.findIndex((d) => d.x === OUT[s].x && d.y === OUT[s].y);

const inside = (r: Rect, p: Pt): boolean =>
  p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** Hộp nở ra `m` px mỗi phía. */
export const inflate = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
});

function axis(values: number[]): number[] {
  const s = [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  const out: number[] = [];
  s.forEach((v, i) => {
    out.push(v);
    const n = s[i + 1];
    if (n !== undefined && n - v > 24) out.push((v + n) / 2); // làn giữa hai hộp
  });
  return out;
}

/** Bỏ điểm thẳng hàng / trùng; giữ điểm đầu và cuối. */
export function simplify(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
    const [a, b, c] = out.slice(-3);
    if (a && b && c && ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)))
      out.splice(out.length - 2, 1);
  }
  return out;
}

/** Hàng đợi ưu tiên nhị phân (khoá số). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.k[p] as number) <= (this.k[i] as number)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0] as number, this.v[0] as number];
    const lk = this.k.pop() as number;
    const lv = this.v.pop() as number;
    if (this.k.length > 0) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && (this.k[l] as number) < (this.k[m] as number)) m = l;
        if (r < this.k.length && (this.k[r] as number) < (this.k[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.k[a], this.k[b]] = [this.k[b] as number, this.k[a] as number];
    [this.v[a], this.v[b]] = [this.v[b] as number, this.v[a] as number];
  }
}

type Grid = { xs: number[]; ys: number[]; blocked: (p: Pt) => boolean };
type Goal = { s1: Pt; e1: Pt; startDir: number; inward: number };

/** Một lần nới lỏng cạnh trên lưới: từ trạng thái `st` đi theo hướng `nd`. */
function step(
  g: Grid,
  dist: Float64Array,
  prev: Int32Array,
  heap: Heap,
  st: number,
  c: number,
): void {
  const ny = g.ys.length;
  const d = st & 3;
  const cell = st >> 2;
  const ix = Math.floor(cell / ny);
  const iy = cell % ny;
  for (let nd = 0; nd < 4; nd++) {
    if (nd === OPP[d]) continue;
    const jx = ix + (DIRS[nd] as Pt).x;
    const jy = iy + (DIRS[nd] as Pt).y;
    if (jx < 0 || jy < 0 || jx >= g.xs.length || jy >= ny) continue;
    const a = { x: g.xs[ix] as number, y: g.ys[iy] as number };
    const b = { x: g.xs[jx] as number, y: g.ys[jy] as number };
    if (g.blocked(b) || g.blocked({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) continue;
    const cost = c + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (nd === d ? 0 : BEND);
    const to = ((jx * ny + jy) << 2) + nd;
    if (cost < (dist[to] as number)) {
      dist[to] = cost;
      prev[to] = st;
      heap.push(cost, to);
    }
  }
}

/** Đường ngắn nhất (có phạt khúc rẽ) trên lưới từ `s1` tới `e1`; null nếu không có. */
function shortest(g: Grid, goal: Goal): Pt[] | null {
  const { xs, ys } = g;
  const ny = ys.length;
  const at = (v: number[], x: number) => v.findIndex((q) => Math.abs(q - x) < 0.01);
  const [ix1, iy1] = [at(xs, goal.s1.x), at(ys, goal.s1.y)];
  const [ix2, iy2] = [at(xs, goal.e1.x), at(ys, goal.e1.y)];
  const dist = new Float64Array(xs.length * ny * 4).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(xs.length * ny * 4).fill(-1);
  const heap = new Heap();
  const start = ((ix1 * ny + iy1) << 2) + goal.startDir;
  dist[start] = 0;
  heap.push(0, start);
  let best = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  while (heap.size > 0) {
    const [c, st] = heap.pop();
    if (c > (dist[st] as number)) continue;
    if (c >= bestCost) break;
    const cell = st >> 2;
    if (Math.floor(cell / ny) === ix2 && cell % ny === iy2) {
      const total = c + ((st & 3) === goal.inward ? 0 : BEND);
      if (total < bestCost) [bestCost, best] = [total, st];
      continue;
    }
    step(g, dist, prev, heap, st, c);
  }
  return best < 0 ? null : rebuild(g, prev, best);
}

/** Dựng lại các điểm lưới của đường từ trạng thái cuối `best` (theo `prev`). */
function rebuild(g: Grid, prev: Int32Array, best: number): Pt[] {
  const ny = g.ys.length;
  const pts: Pt[] = [];
  for (let st = best; st >= 0; st = prev[st] as number) {
    const cell = st >> 2;
    pts.push({ x: g.xs[Math.floor(cell / ny)] as number, y: g.ys[cell % ny] as number });
  }
  return pts.reverse();
}

/** Đường gấp khúc vuông góc từ chấm nguồn tới chấm đích, né mọi hộp. Luôn có kết quả (không tìm được ⇒ khuỷu thẳng). */
export function routeEdge(o: RouteIn): Pt[] {
  const margin = o.margin ?? 8;
  const stub = o.stub ?? 18;
  const so = OUT[o.fromSide];
  const eo = OUT[o.toSide];
  const s1: Pt = { x: o.from.x + so.x * stub, y: o.from.y + so.y * stub };
  const e1: Pt = { x: o.to.x + eo.x * stub, y: o.to.y + eo.y * stub };
  const obs = o.boxes.map((b) => inflate(b, margin));
  const blocked = (p: Pt) => obs.some((r) => inside(r, p));
  const elbow = (): Pt[] => simplify([o.from, s1, { x: e1.x, y: s1.y }, e1, o.to]);
  if (blocked(s1) || blocked(e1)) return elbow();
  const g: Grid = {
    xs: axis([s1.x, e1.x, ...obs.flatMap((r) => [r.x, r.x + r.w])]),
    ys: axis([s1.y, e1.y, ...obs.flatMap((r) => [r.y, r.y + r.h])]),
    blocked,
  };
  const pts = shortest(g, {
    s1,
    e1,
    startDir: dirOfSide(o.fromSide),
    inward: OPP[dirOfSide(o.toSide)] as number,
  });
  return pts ? simplify([o.from, ...pts, o.to]) : elbow();
}
/** Đoạn của đường gấp khúc có cắt phần TRONG của hộp `r` không (đường thẳng trục). */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
}

/** Có đoạn nào của đường cắt phần trong của hộp nào không (kể cả hộp nở `shrink` âm = thu nhỏ). */
export function polylineHitsAny(poly: readonly Pt[], boxes: readonly Rect[], shrink = 0): boolean {
  const bs = boxes.map((b) => inflate(b, -shrink));
  for (let i = 0; i + 1 < poly.length; i++)
    for (const b of bs) if (segmentHitsRect(poly[i] as Pt, poly[i + 1] as Pt, b)) return true;
  return false;
}

/** Độ dài đường gấp khúc. */
export const polyLength = (poly: readonly Pt[]): number =>
  poly.reduce(
    (s, p, i) =>
      i === 0 ? 0 : s + Math.hypot(p.x - (poly[i - 1] as Pt).x, p.y - (poly[i - 1] as Pt).y),
    0,
  );

/** Điểm cách đầu `d` px dọc đường (kẹp trong [0, độ dài]). */
export function pointAt(poly: readonly Pt[], d: number): Pt {
  let left = Math.max(0, Math.min(d, polyLength(poly)));
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[i + 1] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len || i + 2 === poly.length) {
      const t = len === 0 ? 0 : left / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= len;
  }
  return poly[0] ?? { x: 0, y: 0 };
}

/** Chuỗi `d` của SVG: đoạn thẳng + góc bo `r` px (bo nhỏ hơn nửa đoạn ngắn kề). */
export function roundedPath(poly: readonly Pt[], r = 10): string {
  const first = poly[0];
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < poly.length - 1; i++) {
    const p = poly[i - 1] as Pt;
    const c = poly[i] as Pt;
    const n = poly[i + 1] as Pt;
    const lin = Math.hypot(c.x - p.x, c.y - p.y);
    const lout = Math.hypot(n.x - c.x, n.y - c.y);
    const k = Math.min(r, lin / 2, lout / 2);
    const a = { x: c.x + ((p.x - c.x) / lin) * k, y: c.y + ((p.y - c.y) / lin) * k };
    const b = { x: c.x + ((n.x - c.x) / lout) * k, y: c.y + ((n.y - c.y) / lout) * k };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = poly[poly.length - 1];
  return last && poly.length > 1 ? `${d} L ${last.x} ${last.y}` : d;
}

/** Kích thước ước lượng của nhãn trên cạnh ("Từ chối", "Hết hạn"…) — dùng để tránh đè node. */
export const LABEL_BOX = { w: 60, h: 20 } as const;

const hits = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Vị trí nhãn của một cạnh: ưu tiên GIỮA đoạn đầu (ngay sau chấm đầu ra — các đầu ra cạnh nhau có nhãn ở chỗ riêng, không đè nhau dù cùng đích),
 * không vừa thì lùi dần dọc đường tới chỗ hộp nhãn không đè node nào.
 */
export function labelPoint(poly: readonly Pt[], boxes: readonly Rect[]): Pt {
  const a = poly[0];
  const b = poly[1];
  if (!a || !b) return a ?? { x: 0, y: 0 };
  const total = polyLength(poly);
  const first = Math.hypot(b.x - a.x, b.y - a.y);
  const free = (c: Pt) =>
    !boxes.some((r) =>
      hits(
        { x: c.x - LABEL_BOX.w / 2, y: c.y - LABEL_BOX.h / 2, w: LABEL_BOX.w, h: LABEL_BOX.h },
        r,
      ),
    );
  const dists = [
    first / 2,
    ...Array.from({ length: Math.ceil(total / 16) }, (_, i) => 24 + i * 16),
  ];
  for (const d of dists) {
    const c = pointAt(poly, Math.min(d, total));
    if (free(c)) return c;
  }
  return pointAt(poly, first / 2);
}
