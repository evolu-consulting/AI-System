// CR-125 · x9 · hướng bố cục Ngang / Dọc: ánh xạ hướng → ELK (direction, mép cổng, chỗ chừa) và bố cục thật không chồng nhau ở cả hai hướng.
import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api";
import {
  DEFAULT_ASPECT,
  DEFAULT_ASPECT_DOWN,
  type ElkEngine,
  type ElkNode,
  type FlowEdgeIn,
  type FlowNodeIn,
  layoutWithElk,
  PORT_LABEL_H,
  PORT_LABEL_W,
  portExtent,
  portId,
  portSide,
  rootOptions,
  toElkGraph,
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
const nodes: FlowNodeIn[] = [
  { id: "trigger" },
  { id: "gd" },
  ky,
  { id: "kt" },
  { id: "tb" },
  { id: "ok" },
  { id: "no" },
];
const edges: FlowEdgeIn[] = [
  { id: "t>gd", source: "trigger", target: "gd" },
  { id: "gd>ky", source: "gd", target: "ky" },
  { id: "ky>kt", source: "ky", target: "kt", sourceHandle: "exit:done" },
  { id: "kt>tb", source: "kt", target: "tb" },
  { id: "tb>ok", source: "tb", target: "ok" },
  { id: "ky>no#d", source: "ky", target: "no", sourceHandle: "exit:declined:declined,voided" },
  { id: "ky>no#t", source: "ky", target: "no", sourceHandle: "exit:timeout:timeout" },
];

describe("ánh xạ hướng → ELK", () => {
  test("Ngang = RIGHT (mặc định), Dọc = DOWN", () => {
    expect(rootOptions({})["elk.direction"]).toBe("RIGHT");
    expect(rootOptions({ direction: "RIGHT" })["elk.direction"]).toBe("RIGHT");
    expect(rootOptions({ direction: "DOWN" })["elk.direction"]).toBe("DOWN");
  });
  test("tỉ lệ khung: Ngang 2.4, Dọc hẹp hơn; truyền tay thì theo tay", () => {
    expect(rootOptions({})["elk.aspectRatio"]).toBe(String(DEFAULT_ASPECT));
    expect(rootOptions({ direction: "DOWN" })["elk.aspectRatio"]).toBe(String(DEFAULT_ASPECT_DOWN));
    expect(rootOptions({ direction: "DOWN", aspectRatio: 2 })["elk.aspectRatio"]).toBe("2");
  });
  test("cổng ra: Ngang ở mép phải (EAST), Dọc ở mép dưới (SOUTH)", () => {
    expect(portSide(undefined)).toBe("EAST");
    expect(portSide("RIGHT")).toBe("EAST");
    expect(portSide("DOWN")).toBe("SOUTH");
  });
  test("chỗ chừa cho nhãn đầu ra: bên phải (Ngang) / bên dưới (Dọc), chỉ khi ≥ 2 cổng", () => {
    expect(portExtent("RIGHT", 3)).toEqual({ w: PORT_LABEL_W, h: 0 });
    expect(portExtent("DOWN", 3)).toEqual({ w: 0, h: PORT_LABEL_H });
    expect(portExtent("DOWN", 1)).toEqual({ w: 0, h: 0 });
  });
  for (const direction of ["RIGHT", "DOWN"] as const) {
    test(`đồ thị ELK (${direction}): cổng đúng mép + đúng kích thước; cạnh đầu ra theo cổng; thứ tự cổng giữ nguyên`, () => {
      const g = toElkGraph(nodes, edges, { direction });
      const n = g.children?.find((c) => c.id === "ky");
      const extra = portExtent(direction, 3);
      expect(n).toMatchObject({ width: NODE_W + extra.w, height: NODE_H + extra.h });
      expect(n?.ports?.map((p) => p.layoutOptions["elk.port.side"])).toEqual(
        Array(3).fill(portSide(direction)),
      );
      // Dọc: mép dưới ELK đánh số phải → trái ⇒ đảo chỉ số để cổng ĐẦU nằm bên trái như trên màn hình
      const idx = n?.ports?.map((p) => Number(p.layoutOptions["elk.port.index"]));
      expect(idx).toEqual(direction === "DOWN" ? [2, 1, 0] : [0, 1, 2]);
      expect(g.edges?.find((e) => e.id === "ky>kt")?.sources).toEqual([portId("ky", "exit:done")]);
      expect(g.edges?.find((e) => e.id === "ky>no#t")?.sources).toEqual([
        portId("ky", "exit:timeout:timeout"),
      ]);
    });
  }
});

/** Cặp node giao nhau (hộp có chừa cổng đầu ra theo hướng) sau `settlePositions`. */
function clashes(
  direction: "RIGHT" | "DOWN",
  auto: Map<string, { x: number; y: number }>,
): string[] {
  const items: SettleItem[] = nodes.map((n) => {
    const x = portExtent(direction, n.ports?.length ?? 0);
    return { id: n.id, auto: auto.get(n.id), w: NODE_W + x.w, h: NODE_H + x.h };
  });
  const pos = settlePositions(items);
  const box = (p: { x: number; y: number }, it: SettleItem) => ({
    ...p,
    w: it.w ?? NODE_W,
    h: it.h ?? NODE_H,
  });
  const out: string[] = [];
  items.forEach((a, i) => {
    for (const b of items.slice(i + 1)) {
      const [pa, pb] = [pos.get(a.id), pos.get(b.id)];
      if (pa && pb && overlaps(box(pa, a), box(pb, b), SETTLE_GAP)) out.push(`${a.id}×${b.id}`);
    }
  });
  return out;
}

describe("bố cục thật: không hai node giao nhau ở cả hai hướng", () => {
  for (const direction of ["RIGHT", "DOWN"] as const) {
    test(direction === "RIGHT" ? "Ngang" : "Dọc", async () => {
      const auto = await layoutWithElk(nodes, edges, engine, { direction });
      expect(auto.size).toBe(nodes.length);
      expect(clashes(direction, auto)).toEqual([]);
    });
  }
  test("luồng đi đúng chiều: Ngang ⇒ x tăng, Dọc ⇒ y tăng", async () => {
    const pair = [{ id: "a" }, { id: "b" }];
    const link = [{ id: "a>b", source: "a", target: "b" }];
    const h = await layoutWithElk(pair, link, engine, { direction: "RIGHT" });
    const v = await layoutWithElk(pair, link, engine, { direction: "DOWN" });
    expect((h.get("b")?.x ?? 0) > (h.get("a")?.x ?? 0)).toBe(true);
    expect((v.get("b")?.y ?? 0) > (v.get("a")?.y ?? 0)).toBe(true);
  });
});
