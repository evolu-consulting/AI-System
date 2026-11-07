// CR-125 · x10 · sơ đồ demo + bước thêm (Kế toán duyệt chi) PHẢI đọc được như một văn bản, ở cả Ngang và Dọc: bước sau nằm sau bước trước theo chiều flow,
// các node Kết thúc gom ở tầng cuối (không node mồ côi), ít cạnh cắt nhau, nhãn không đè nhau, đường chính không quay đầu.
import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api";
import {
  LABEL_BOX,
  labelPoint,
  type Pt,
  type Rect,
  routeEdge,
  type Side,
} from "../routing/orthogonal";
import {
  type ElkEngine,
  type ElkNode,
  type FlowDirection,
  type FlowEdgeIn,
  type FlowNodeIn,
  layoutWithElk,
  portExtent,
} from "./elk";
import { NODE_H, NODE_W } from "./geometry";
import { type SettleItem, settlePositions } from "./settle";

const elk = new ELK({
  workerFactory: () => new Worker(Bun.resolveSync("elkjs/lib/elk-worker.min.js", import.meta.dir)),
});
const engine: ElkEngine = { layout: (g) => elk.layout(g as never) as unknown as Promise<ElkNode> };
afterAll(() => elk.terminateWorker());

const EXITS = ["exit:done", "exit:declined:declined,voided", "exit:timeout:timeout"];
/** Thứ tự khai báo = thứ tự đọc flow (Bắt đầu khi · Nếu · hai nhánh duyệt · Ký số · Kế toán duyệt chi · các Kết thúc). */
const nodes: FlowNodeIn[] = [
  { id: "trigger", layer: "first" },
  { id: "if", ports: ["yes", "no"] },
  { id: "pc" },
  { id: "kt0" },
  { id: "ky", ports: EXITS },
  { id: "acc" },
  { id: "ok", layer: "last" },
  { id: "no", layer: "last" },
  { id: "ret", layer: "last" }, // Kết thúc · Trả lại: không cạnh nào tới (mồ côi nếu không gom vào tầng cuối)
];
type E = FlowEdgeIn & { exit?: number; label?: string; main?: boolean };
const edges: E[] = [
  { id: "t>if", source: "trigger", target: "if", main: true },
  { id: "if>pc", source: "if", target: "pc", sourceHandle: "yes", main: true },
  { id: "if>kt0", source: "if", target: "kt0", sourceHandle: "no" },
  { id: "pc>ky", source: "pc", target: "ky", main: true },
  { id: "kt0>ky", source: "kt0", target: "ky" },
  { id: "ky>acc", source: "ky", target: "acc", sourceHandle: EXITS[0] ?? "", exit: 0, main: true },
  { id: "acc>ok", source: "acc", target: "ok", main: true },
  {
    id: "ky>no#d",
    source: "ky",
    target: "no",
    sourceHandle: EXITS[1] ?? "",
    exit: 1,
    label: "Từ chối",
  },
  {
    id: "ky>no#t",
    source: "ky",
    target: "no",
    sourceHandle: EXITS[2] ?? "",
    exit: 2,
    label: "Hết hạn",
  },
];

type Anchors = { a: Pt; as: Side; b: Pt; bs: Side };
const IF_PORT = { yes: 0, no: 1 } as const;
function anchors(dir: FlowDirection, from: Rect, to: Rect, e: E): Anchors {
  const slot =
    e.exit !== undefined
      ? (e.exit + 1) / 4
      : e.sourceHandle === "yes"
        ? 0.26
        : e.sourceHandle === "no"
          ? 0.74
          : 0.5;
  const over = e.exit !== undefined ? (dir === "RIGHT" ? 35 : 11) : 0;
  if (dir === "RIGHT")
    return {
      a: { x: from.x + from.w + over, y: from.y + from.h * slot },
      as: "right",
      b: { x: to.x, y: to.y + to.h / 2 },
      bs: "left",
    };
  return {
    a: { x: from.x + from.w * slot, y: from.y + from.h + over },
    as: "bottom",
    b: { x: to.x + to.w / 2, y: to.y },
    bs: "top",
  };
}

type Routed = { e: E; poly: Pt[] };
async function layout(dir: FlowDirection): Promise<{ box: Map<string, Rect>; routed: Routed[] }> {
  const auto = await layoutWithElk(nodes, edges, engine, { direction: dir });
  const items: SettleItem[] = nodes.map((n) => {
    const x = portExtent(dir, n.ports?.length ?? 0);
    return { id: n.id, auto: auto.get(n.id), w: NODE_W + x.w, h: NODE_H + x.h };
  });
  const pos = settlePositions(items);
  const box = new Map(nodes.map((n) => [n.id, { ...(pos.get(n.id) as Pt), w: NODE_W, h: NODE_H }]));
  const all = [...box.values()];
  const routed = edges.map((e) => {
    const k = anchors(dir, box.get(e.source) as Rect, box.get(e.target) as Rect, e);
    return { e, poly: routeEdge({ from: k.a, fromSide: k.as, to: k.b, toSide: k.bs, boxes: all }) };
  });
  return { box, routed };
}

/** Hai đoạn trục vuông góc nhau có cắt ở phần TRONG của cả hai không (chạm đầu mút / chung đường không tính). */
function crosses(a0: Pt, a1: Pt, b0: Pt, b1: Pt): boolean {
  const aH = a0.y === a1.y;
  if (aH === (b0.y === b1.y)) return false;
  const [h0, h1, v0, v1] = aH ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
  const inX = v0.x > Math.min(h0.x, h1.x) + 0.5 && v0.x < Math.max(h0.x, h1.x) - 0.5;
  const inY = h0.y > Math.min(v0.y, v1.y) + 0.5 && h0.y < Math.max(v0.y, v1.y) - 0.5;
  return inX && inY;
}

type Seg = readonly [Pt, Pt];
const segsOf = (poly: readonly Pt[]): Seg[] =>
  poly.slice(1).map((p, i) => [poly[i] as Pt, p] as const);

/** Số cặp đoạn (của hai cạnh khác nhau) cắt nhau. */
function crossings(rs: readonly Routed[]): number {
  const segs = rs.map((r) => segsOf(r.poly));
  const between = (xs: readonly Seg[], ys: readonly Seg[]): number =>
    xs.flatMap(([a0, a1]) => ys.filter(([b0, b1]) => crosses(a0, a1, b0, b1))).length;
  return segs.reduce((n, s, i) => n + segs.slice(i + 1).reduce((m, o) => m + between(s, o), 0), 0);
}
const labelRect = (poly: Pt[], boxes: Rect[]): Rect => {
  const c = labelPoint(poly, boxes);
  return { x: c.x - LABEL_BOX.w / 2, y: c.y - LABEL_BOX.h / 2, w: LABEL_BOX.w, h: LABEL_BOX.h };
};
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const dir of ["RIGHT", "DOWN"] as const) {
  describe(`sơ đồ demo + Kế toán duyệt chi đọc được (${dir === "RIGHT" ? "Ngang" : "Dọc"})`, () => {
    const axis = (r: Rect) => (dir === "RIGHT" ? r.x : r.y);
    const lay = layout(dir);

    test("bước sau nằm sau bước trước theo chiều flow (mọi cạnh tiến)", async () => {
      const { box } = await lay;
      for (const e of edges)
        expect(axis(box.get(e.target) as Rect), `${e.id}: đích phải nằm sau nguồn`).toBeGreaterThan(
          axis(box.get(e.source) as Rect),
        );
    });
    test("các node Kết thúc gom ở tầng cuối, Bắt đầu khi ở tầng đầu, không node mồ côi ở đầu sơ đồ", async () => {
      const { box } = await lay;
      const ends = ["ok", "no", "ret"].map((id) => axis(box.get(id) as Rect));
      expect(new Set(ends).size).toBe(1);
      const others = nodes
        .filter((n) => n.layer !== "last")
        .map((n) => axis(box.get(n.id) as Rect));
      expect(Math.min(...ends)).toBeGreaterThan(Math.max(...others));
      expect(axis(box.get("trigger") as Rect)).toBe(Math.min(...others));
    });
    test("số cạnh cắt nhau ≤ 1", async () => {
      expect(crossings((await lay).routed)).toBeLessThanOrEqual(1);
    });
    test("nhãn Từ chối / Hết hạn không đè nhau và không đè node", async () => {
      const { box, routed } = await lay;
      const labels = routed
        .filter((r) => r.e.label)
        .map((r) => labelRect(r.poly, [...box.values()]));
      expect(labels).toHaveLength(2);
      expect(overlap(labels[0] as Rect, labels[1] as Rect)).toBe(false);
      for (const l of labels) for (const b of box.values()) expect(overlap(l, b)).toBe(false);
    });
    test("đường chính (Bắt đầu khi → … → Kế toán duyệt chi → Kết thúc) không quay đầu ngược chiều flow", async () => {
      const { routed } = await lay;
      for (const r of routed.filter((x) => x.e.main)) {
        const v = r.poly.map((p) => (dir === "RIGHT" ? p.x : p.y));
        for (let i = 1; i < v.length; i++)
          expect(v[i] as number, `${r.e.id} quay đầu`).toBeGreaterThanOrEqual(
            (v[i - 1] as number) - 0.5,
          );
      }
    });
  });
}

void IF_PORT;
