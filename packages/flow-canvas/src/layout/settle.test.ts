// CR-125 · x4 · node KHÔNG BAO GIỜ chồng nhau sau mọi lần sửa / bố cục lại (ELK thật qua worker của bun, không cần trình duyệt).
import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api";
import {
  type ElkEngine,
  type ElkNode,
  type FlowEdgeIn,
  type FlowNodeIn,
  fallbackPositions,
  layoutWithElk,
  PORT_LABEL_W,
} from "./elk";
import { NODE_H, NODE_W } from "./geometry";
import { overlaps, SETTLE_GAP, type SettleItem, settlePositions } from "./settle";

const elk = new ELK({
  workerFactory: () => new Worker(Bun.resolveSync("elkjs/lib/elk-worker.min.js", import.meta.dir)),
});
const engine: ElkEngine = { layout: (g) => elk.layout(g as never) as unknown as Promise<ElkNode> };
afterAll(() => elk.terminateWorker());

const ky: FlowNodeIn = {
  id: "ky",
  ports: ["exit:done", "exit:declined:declined,voided", "exit:timeout:timeout"],
};
const demoNodes: FlowNodeIn[] = [
  { id: "trigger" },
  { id: "tp" },
  { id: "gd" },
  ky,
  { id: "tb" },
  { id: "ok" },
  { id: "no" },
  { id: "ret" },
];
const demoEdges: FlowEdgeIn[] = [
  { id: "t>tp", source: "trigger", target: "tp" },
  { id: "tp>gd", source: "tp", target: "gd" },
  { id: "gd>ky", source: "gd", target: "ky" },
  { id: "ky>tb", source: "ky", target: "tb" },
  { id: "tb>ok", source: "tb", target: "ok" },
  { id: "ky>no#d", source: "ky", target: "no", sourceHandle: "exit:declined:declined,voided" },
  { id: "ky>no#t", source: "ky", target: "no", sourceHandle: "exit:timeout:timeout" },
  { id: "gd>ret", source: "gd", target: "ret" },
];
/** Admin thêm "Kế toán duyệt chi" ngay sau Ký xong (ky → kt → tb). */
const addedNodes: FlowNodeIn[] = [...demoNodes, { id: "kt" }];
const addedEdges: FlowEdgeIn[] = [
  ...demoEdges.filter((e) => e.id !== "ky>tb"),
  { id: "ky>kt", source: "ky", target: "kt" },
  { id: "kt>tb", source: "kt", target: "tb" },
];

const wOf = (n: FlowNodeIn): number => NODE_W + ((n.ports?.length ?? 0) > 1 ? PORT_LABEL_W : 0);
const itemsOf = (
  nodes: readonly FlowNodeIn[],
  auto: Map<string, { x: number; y: number }>,
  manual: Record<string, { x: number; y: number }> = {},
): SettleItem[] =>
  nodes.map((n) => ({ id: n.id, auto: auto.get(n.id), manual: manual[n.id], w: wOf(n) }));

/** Cặp node có hộp giao nhau (rỗng = đạt). */
function intersections(
  items: readonly SettleItem[],
  pos: Map<string, { x: number; y: number }>,
  gap = 0,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [a, b] = [items[i] as SettleItem, items[j] as SettleItem];
      const [pa, pb] = [pos.get(a.id), pos.get(b.id)];
      if (!pa || !pb) continue;
      const box = (p: { x: number; y: number }, it: SettleItem) => ({
        ...p,
        w: it.w ?? NODE_W,
        h: it.h ?? NODE_H,
      });
      if (overlaps(box(pa, a), box(pb, b), gap)) out.push(`${a.id}×${b.id}`);
    }
  return out;
}

describe("sau bố cục lại: không hai node nào giao nhau", () => {
  test("flow demo (có Ký số 3 đầu ra)", async () => {
    const auto = await layoutWithElk(demoNodes, demoEdges, engine);
    const items = itemsOf(demoNodes, auto);
    const pos = settlePositions(items);
    expect(pos.size).toBe(demoNodes.length);
    expect(intersections(items, pos, SETTLE_GAP)).toEqual([]);
  });

  test("flow demo + một bước thêm sau Ký xong (Kế toán duyệt chi)", async () => {
    const auto = await layoutWithElk(addedNodes, addedEdges, engine);
    const items = itemsOf(addedNodes, auto);
    const pos = settlePositions(items);
    expect(pos.size).toBe(addedNodes.length);
    expect(intersections(items, pos, SETTLE_GAP)).toEqual([]);
    // ELK tự nó đã không xếp chồng (không cần cứu): vị trí cuối = toạ độ ELK
    for (const n of addedNodes) expect(pos.get(n.id)).toEqual(auto.get(n.id));
  });

  test("bước thả tay đè lên node khác ⇒ quay về toạ độ ELK, thả chỗ trống thì giữ", async () => {
    const auto = await layoutWithElk(addedNodes, addedEdges, engine);
    const ok = auto.get("ok") as { x: number; y: number };
    const free = { x: 4000, y: 4000 };
    const items = itemsOf(addedNodes, auto, { kt: { x: ok.x + 20, y: ok.y + 30 }, ret: free });
    const pos = settlePositions(items);
    expect(pos.get("kt")).toEqual(auto.get("kt")); // đè "ok" ⇒ về chỗ ELK
    expect(pos.get("ret")).toEqual(free); // không đè ⇒ giữ vị trí tay
    expect(intersections(items, pos, SETTLE_GAP)).toEqual([]);
  });

  test("hai bước thả tay đè nhau: chỉ một bước được giữ", async () => {
    const auto = await layoutWithElk(addedNodes, addedEdges, engine);
    const items = itemsOf(addedNodes, auto, {
      kt: { x: 5000, y: 5000 },
      ret: { x: 5010, y: 5020 },
    });
    const pos = settlePositions(items);
    expect(pos.get("ret")).toEqual({ x: 5010, y: 5020 }); // đứng trước trong danh sách ⇒ được giữ
    expect(pos.get("kt")).toEqual(auto.get("kt"));
    expect(intersections(items, pos, SETTLE_GAP)).toEqual([]);
  });

  test("toạ độ ELK tự nó đè nhau (dự phòng, kích thước lệch) ⇒ vẫn được tách ra", () => {
    const auto = new Map(addedNodes.map((n) => [n.id, { x: 100, y: 100 }]));
    const items = itemsOf(addedNodes, auto);
    const pos = settlePositions(items);
    expect(intersections(items, pos, SETTLE_GAP)).toEqual([]);
  });

  test("lưới dự phòng không chồng nhau", () => {
    const items = itemsOf(addedNodes, fallbackPositions(addedNodes));
    expect(intersections(items, settlePositions(items), SETTLE_GAP)).toEqual([]);
  });

  test("node chưa có toạ độ nào ⇒ chưa hiện, có vị trí tay mà chưa có ELK ⇒ hiện tại chỗ tay", () => {
    const pos = settlePositions([
      { id: "a" },
      { id: "b", manual: { x: 10, y: 20 } },
      { id: "c", auto: { x: 1000, y: 0 } },
    ]);
    expect(pos.has("a")).toBe(false);
    expect(pos.get("b")).toEqual({ x: 10, y: 20 });
    expect(pos.get("c")).toEqual({ x: 1000, y: 0 });
  });
});
