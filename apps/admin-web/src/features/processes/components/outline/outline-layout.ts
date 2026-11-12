// CR-127 · UI-FLOW · mock Editor.dc: bố cục TỰ ĐỘNG từ trên xuống của sơ đồ soạn quy trình — THUẦN (không React, không xyflow).
// Vào: cây bước đã gọn (`LItem[]`: bước / Nếu có hai nhánh Đúng–Sai / Hoàn tất). Ra: toạ độ node + cạnh. Không lưu toạ độ, không kéo thả tự do.
// Một cột giữa: Bắt đầu → [+] → bước → [+] → … → Hoàn tất. Nếu tách HAI CỘT cạnh nhau (Đúng | Sai), mỗi cột dài ra độc lập rồi nhập lại bằng
// một "ngoặc" dưới chân; mỗi khoảng giữa hai khối có nút "+" (node `gap`) nằm TRÊN đường nối. Nhánh trống vẽ khung nét đứt + "+".
import type { Loc } from "../../lib/outline-edit";

export type LItem = {
  id: string;
  kind: "step" | "if" | "end";
  /** Chỉ số chèn NGAY SAU khối này trong danh sách chứa nó (`i + span` của cụm nhiều bước, vd Ký số). */
  after: number;
  yes?: LItem[];
  no?: LItem[];
};

export type LNodeType = "start" | "step" | "if" | "end" | "gap" | "label" | "empty" | "dot";
export type LNode = {
  id: string;
  type: LNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `gap`: nơi chèn. */
  loc?: Loc;
  index?: number;
  /** `label` / `empty`: nhánh nào. */
  side?: "yes" | "no";
};
/** `line` = đường thẳng dọc; `fork` / `join` = đường gấp khúc từ khối Nếu xuống hai cột / từ hai cột nhập lại. */
export type LEdge = { id: string; source: string; target: string; kind: "line" | "fork" | "join" };
export type Layout = {
  nodes: LNode[];
  edges: LEdge[];
  bounds: { x: number; y: number; w: number; h: number };
};

export const SIZE = {
  stepMain: 400,
  stepBranch: 260,
  ifMain: 320,
  ifBranch: 220,
  stepH: 72,
  startH: 72,
  endH: 80,
  ifH: 64,
  gap: 24,
  /** Đoạn đường nối giữa hai khối (trên / dưới nút "+"). */
  ln: 12,
  label: { w: 48, h: 18 },
  empty: { w: 200, h: 44 },
  colGap: 32,
  /** Khoảng từ chân khối Nếu tới nhãn Đúng / Sai (gồm một đoạn ngang của cạnh gấp). */
  fork: 16,
  /** Khoảng từ chân hai cột tới điểm nhập lại. */
  joinDrop: 28,
} as const;

const stepW = (depth: number) => (depth === 0 ? SIZE.stepMain : SIZE.stepBranch);
const ifW = (depth: number) => (depth === 0 ? SIZE.ifMain : SIZE.ifBranch);

/** Bề rộng một dãy khối ở độ sâu `depth` (khối rộng nhất; khối Nếu = hai cột + khe). */
export function widthOf(items: readonly LItem[], depth: number): number {
  let w = items.length === 0 ? SIZE.empty.w : 0;
  for (const it of items) {
    if (it.kind === "if") {
      const cols = widthOf(it.yes ?? [], depth + 1) + SIZE.colGap + widthOf(it.no ?? [], depth + 1);
      w = Math.max(w, ifW(depth), cols);
    } else w = Math.max(w, stepW(depth));
  }
  return Math.max(w, depth === 0 ? 0 : SIZE.stepBranch);
}

export const gapId = (loc: Loc, index: number): string =>
  `gap:${loc ? `${loc.ifKey}:${loc.side}` : "main"}:${index}`;
export const gapTestId = (loc: Loc, index: number): string =>
  `outline-add-${loc ? `${loc.ifKey}-${loc.side}` : "main"}-${index}`;

type Cursor = { prev: string | null; y: number };

class Builder {
  readonly nodes: LNode[] = [];
  readonly edges: LEdge[] = [];
  cur: Cursor = { prev: null, y: 0 };

  /** Đặt node ngay dưới con trỏ (cách `ln` nếu có node trước), nối cạnh từ node trước. */
  put(n: Omit<LNode, "y" | "x"> & { cx: number }, kind: LEdge["kind"] = "line", lift = 0): LNode {
    const { cx, ...rest } = n;
    const y = this.cur.y + (this.cur.prev ? SIZE.ln : 0) + lift;
    const node: LNode = { ...rest, x: cx - n.w / 2, y };
    this.nodes.push(node);
    if (this.cur.prev)
      this.edges.push({
        id: `${this.cur.prev}>${n.id}`,
        source: this.cur.prev,
        target: n.id,
        kind,
      });
    this.cur = { prev: n.id, y: y + n.h };
    return node;
  }

  gap(loc: Loc, index: number, cx: number, kind: LEdge["kind"] = "line"): void {
    this.put(
      { id: gapId(loc, index), type: "gap", w: SIZE.gap, h: SIZE.gap, cx, loc, index },
      kind,
    );
  }

  sequence(items: readonly LItem[], loc: Loc, cx: number, depth: number): void {
    for (const it of items) {
      if (it.kind === "end") {
        this.put({ id: it.id, type: "end", w: stepW(depth), h: SIZE.endH, cx });
        continue;
      }
      if (it.kind === "step")
        this.put({ id: it.id, type: "step", w: stepW(depth), h: SIZE.stepH, cx });
      else this.branches(it, cx, depth);
      this.gap(loc, it.after, cx);
    }
  }

  private branches(it: LItem, cx: number, depth: number): void {
    this.put({ id: it.id, type: "if", w: ifW(depth), h: SIZE.ifH, cx });
    const yes = it.yes ?? [];
    const no = it.no ?? [];
    const wy = widthOf(yes, depth + 1);
    const wn = widthOf(no, depth + 1);
    const total = wy + SIZE.colGap + wn;
    const base = this.cur;
    const cols = [
      { side: "yes" as const, list: yes, cx: cx - total / 2 + wy / 2 },
      { side: "no" as const, list: no, cx: cx + total / 2 - wn / 2 },
    ];
    const ends: { id: string; y: number; cx: number }[] = [];
    for (const c of cols) {
      this.cur = base;
      const loc: Loc = { ifKey: it.id, side: c.side };
      this.put(
        {
          id: `label:${it.id}:${c.side}`,
          type: "label",
          w: SIZE.label.w,
          h: SIZE.label.h,
          cx: c.cx,
          side: c.side,
        },
        "fork",
        SIZE.fork,
      );
      if (c.list.length === 0) {
        this.put({
          id: `empty:${it.id}:${c.side}`,
          type: "empty",
          w: SIZE.empty.w,
          h: SIZE.empty.h,
          cx: c.cx,
          side: c.side,
        });
        this.gap(loc, 0, c.cx);
      } else {
        this.gap(loc, 0, c.cx);
        this.sequence(c.list, loc, c.cx, depth + 1);
      }
      ends.push({ id: this.cur.prev as string, y: this.cur.y, cx: c.cx });
    }
    const bottom = Math.max(...ends.map((e) => e.y));
    const join = `join:${it.id}`;
    for (const [k, e] of ends.entries()) {
      const tail = `tail:${it.id}:${k}`;
      this.nodes.push({ id: tail, type: "dot", x: e.cx - 1, y: bottom, w: 2, h: 2 });
      this.edges.push({ id: `${e.id}>${tail}`, source: e.id, target: tail, kind: "line" });
      this.edges.push({ id: `${tail}>${join}`, source: tail, target: join, kind: "join" });
    }
    this.nodes.push({ id: join, type: "dot", x: cx - 1, y: bottom + SIZE.joinDrop, w: 2, h: 2 });
    this.cur = { prev: join, y: bottom + SIZE.joinDrop + 2 };
  }
}

/** Bố cục cả quy trình. `start` = có khối "Khi nào chạy" đầu sơ đồ. Cột chính nằm ở x = 0. */
export function layoutOutline(items: readonly LItem[], start: boolean): Layout {
  const b = new Builder();
  if (start) b.put({ id: "start", type: "start", w: SIZE.stepMain, h: SIZE.startH, cx: 0 });
  b.gap(null, 0, 0);
  b.sequence(items, null, 0, 0);
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  for (const n of b.nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { nodes: b.nodes, edges: b.edges, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
