// CR-125 · x9 · cạnh định tuyến NÉ node: bắt đầu đúng ở chấm đầu ra, không đoạn nào cắt hộp node nào (flow demo + bước thêm, Ngang và Dọc).
import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api";
import {
  type ElkEngine,
  type ElkNode,
  type FlowEdgeIn,
  type FlowNodeIn,
  layoutWithElk,
  portExtent,
} from "../layout/elk";
import { NODE_H, NODE_W } from "../layout/geometry";
import { type SettleItem, settlePositions } from "../layout/settle";
import {
  type Pt,
  pointAt,
  polyLength,
  polylineHitsAny,
  type Rect,
  roundedPath,
  routeEdge,
  type Side,
} from "./orthogonal";

const elk = new ELK({
  workerFactory: () => new Worker(Bun.resolveSync("elkjs/lib/elk-worker.min.js", import.meta.dir)),
});
const engine: ElkEngine = { layout: (g) => elk.layout(g as never) as unknown as Promise<ElkNode> };
afterAll(() => elk.terminateWorker());

describe("routeEdge cơ bản", () => {
  test("không vật cản: đường bắt đầu đúng ở chấm nguồn, kết thúc đúng ở chấm đích, rời chấm theo mép", () => {
    const r = routeEdge({
      from: { x: 100, y: 50 },
      fromSide: "right",
      to: { x: 400, y: 50 },
      toSide: "left",
      boxes: [],
    });
    expect(r[0]).toEqual({ x: 100, y: 50 });
    expect(r.at(-1)).toEqual({ x: 400, y: 50 });
    expect(r.length).toBe(2); // thẳng
  });
  test("đích nằm sau nguồn (quay lại): vẫn rời chấm theo mép phải rồi đi vòng, không đi xuyên node nguồn", () => {
    const src: Rect = { x: 0, y: 0, w: 240, h: 104 };
    const dst: Rect = { x: -400, y: 0, w: 240, h: 104 };
    const r = routeEdge({
      from: { x: 240, y: 52 },
      fromSide: "right",
      to: { x: -400, y: 52 },
      toSide: "left",
      boxes: [src, dst],
    });
    expect(r[1]?.x).toBeGreaterThan(240); // rời sang phải trước
    expect(polylineHitsAny(r, [src, dst], 1)).toBe(false);
  });
  test("vật cản chắn giữa: đi vòng, không cắt hộp", () => {
    const wall: Rect = { x: 150, y: -200, w: 40, h: 400 };
    const r = routeEdge({
      from: { x: 100, y: 0 },
      fromSide: "right",
      to: { x: 300, y: 0 },
      toSide: "left",
      boxes: [wall],
    });
    expect(polylineHitsAny(r, [wall], 1)).toBe(false);
    expect(r[0]).toEqual({ x: 100, y: 0 });
  });
});

describe("routeEdge cơ bản", () => {
  test("mọi đoạn vuông góc; roundedPath và pointAt khớp độ dài", () => {
    const r = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "bottom",
      to: { x: 300, y: 200 },
      toSide: "top",
      boxes: [{ x: 100, y: 60, w: 100, h: 60 }],
    });
    for (let i = 0; i + 1 < r.length; i++) {
      const [a, b] = [r[i] as Pt, r[i + 1] as Pt];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    expect(roundedPath(r)).toStartWith("M 0 0");
    const len = polyLength(r);
    expect(pointAt(r, 0)).toEqual(r[0] as Pt);
    expect(pointAt(r, len)).toEqual(r.at(-1) as Pt);
    expect(pointAt(r, len / 2)).toBeDefined();
  });
});

// ---- flow demo + "Kế toán duyệt chi" ----------------------------------------------------------------------------
const ky: FlowNodeIn = {
  id: "ky",
  ports: ["exit:done", "exit:declined:declined,voided", "exit:timeout:timeout"],
};
const nodes: FlowNodeIn[] = [
  { id: "trigger" },
  { id: "tp" },
  { id: "gd" },
  ky,
  { id: "kt" },
  { id: "tb" },
  { id: "ok" },
  { id: "no" },
  { id: "ret" },
];
const edges: (FlowEdgeIn & { exit?: number })[] = [
  { id: "t>tp", source: "trigger", target: "tp" },
  { id: "tp>gd", source: "tp", target: "gd" },
  { id: "gd>ky", source: "gd", target: "ky" },
  { id: "ky>kt", source: "ky", target: "kt", sourceHandle: "exit:done", exit: 0 },
  { id: "kt>tb", source: "kt", target: "tb" },
  { id: "tb>ok", source: "tb", target: "ok" },
  {
    id: "ky>no#d",
    source: "ky",
    target: "no",
    sourceHandle: "exit:declined:declined,voided",
    exit: 1,
  },
  { id: "ky>no#t", source: "ky", target: "no", sourceHandle: "exit:timeout:timeout", exit: 2 },
  { id: "gd>ret", source: "gd", target: "ret" },
];

const PILL = 11; // chấm đầu ra nhô ra khỏi mép node (nửa chiều cao nhãn) — Dọc; Ngang nhô nửa chiều rộng
const PILL_W = 35;

/** Chấm nguồn / đích đúng như xyflow đặt: Ngang ⇒ ra mép phải, vào mép trái; Dọc ⇒ ra mép dưới, vào mép trên. */
function anchors(
  dir: "RIGHT" | "DOWN",
  from: Rect,
  to: Rect,
  exit: number | undefined,
): { a: Pt; as: Side; b: Pt; bs: Side } {
  const n = 3;
  if (dir === "RIGHT")
    return {
      a: {
        x: from.x + from.w + (exit === undefined ? 0 : PILL_W),
        y: from.y + from.h * (exit === undefined ? 0.5 : (exit + 1) / (n + 1)),
      },
      as: "right",
      b: { x: to.x, y: to.y + to.h / 2 },
      bs: "left",
    };
  return {
    a: {
      x: from.x + from.w * (exit === undefined ? 0.5 : (exit + 1) / (n + 1)),
      y: from.y + from.h + (exit === undefined ? 0 : PILL),
    },
    as: "bottom",
    b: { x: to.x + to.w / 2, y: to.y },
    bs: "top",
  };
}

for (const direction of ["RIGHT", "DOWN"] as const) {
  describe(`flow demo + Kế toán duyệt chi (${direction === "RIGHT" ? "Ngang" : "Dọc"}): không cạnh nào cắt node`, () => {
    test("mọi cạnh bắt đầu ở chấm và không cắt hộp node nào", async () => {
      const auto = await layoutWithElk(nodes, edges, engine, { direction });
      const items: SettleItem[] = nodes.map((nd) => {
        const x = portExtent(direction, nd.ports?.length ?? 0);
        return { id: nd.id, auto: auto.get(nd.id), w: NODE_W + x.w, h: NODE_H + x.h };
      });
      const pos = settlePositions(items);
      // hộp node thật (không gồm phần chừa cho nhãn đầu ra)
      const box = (id: string): Rect => ({
        ...(pos.get(id) as Pt),
        w: NODE_W,
        h: NODE_H,
      });
      const boxes = nodes.map((nd) => box(nd.id));
      for (const e of edges) {
        const { a, as, b, bs } = anchors(direction, box(e.source), box(e.target), e.exit);
        const r = routeEdge({ from: a, fromSide: as, to: b, toSide: bs, boxes });
        expect(r[0]).toEqual(a); // bắt đầu đúng ở chấm
        expect(r.at(-1)).toEqual(b);
        expect(polylineHitsAny(r, boxes, 1), `cạnh ${e.id} cắt một node`).toBe(false);
      }
    });
  });
}
