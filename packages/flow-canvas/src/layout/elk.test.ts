// CR-123 · u13 · bộ chuyển đồ thị → ELK → toạ độ: thứ tự cổng, cạnh, gập hàng (chạy ELK thật qua worker của bun, không cần trình duyệt).
import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api";
import {
  type ElkEngine,
  type ElkNode,
  fallbackPositions,
  layoutWithElk,
  portId,
  positionsOf,
  toElkGraph,
} from "./elk";
import { NODE_H, NODE_W } from "./geometry";

const elk = new ELK({
  workerFactory: () => new Worker(Bun.resolveSync("elkjs/lib/elk-worker.min.js", import.meta.dir)),
});
const engine: ElkEngine = { layout: (g) => elk.layout(g as never) as unknown as Promise<ElkNode> };
afterAll(() => elk.terminateWorker());

const ky = {
  id: "ky",
  ports: ["exit:done", "exit:declined:declined,voided", "exit:timeout:timeout"],
};
const demo = {
  nodes: [
    { id: "trigger" },
    { id: "tp" },
    { id: "gd" },
    ky,
    { id: "tb" },
    { id: "ok" },
    { id: "no" },
    { id: "ret" },
  ],
  edges: [
    { id: "t>tp", source: "trigger", target: "tp" },
    { id: "tp>gd", source: "tp", target: "gd" },
    { id: "gd>ky", source: "gd", target: "ky" },
    { id: "ky>tb", source: "ky", target: "tb" }, // đầu ra "đi tiếp" không nêu cổng ⇒ cổng đầu
    { id: "tb>ok", source: "tb", target: "ok" },
    { id: "ky>no#d", source: "ky", target: "no", sourceHandle: "exit:declined:declined,voided" },
    { id: "ky>no#t", source: "ky", target: "no", sourceHandle: "exit:timeout:timeout" },
    { id: "gd>ret", source: "gd", target: "ret" },
  ],
};

describe("toElkGraph", () => {
  const g = toElkGraph(demo.nodes, demo.edges);
  test("layered, trái → phải, cạnh vuông góc, gập hàng theo tỉ lệ khung", () => {
    expect(g.layoutOptions).toMatchObject({
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.wrapping.strategy": "MULTI_EDGE",
      "elk.aspectRatio": "2.4",
    });
    expect(toElkGraph([], [], { aspectRatio: 3 }).layoutOptions?.["elk.aspectRatio"]).toBe("3");
  });
  test("node nhiều đầu ra có cổng ở mép phải, thứ tự cố định, kích thước mặc định", () => {
    const node = g.children?.find((c) => c.id === "ky");
    expect(node).toMatchObject({ width: NODE_W, height: NODE_H });
    expect(node?.layoutOptions).toEqual({ "elk.portConstraints": "FIXED_ORDER" });
    expect(
      node?.ports?.map((p) => [
        p.id,
        p.layoutOptions["elk.port.side"],
        p.layoutOptions["elk.port.index"],
      ]),
    ).toEqual([
      [portId("ky", "exit:done"), "EAST", "0"],
      [portId("ky", "exit:declined:declined,voided"), "EAST", "1"],
      [portId("ky", "exit:timeout:timeout"), "EAST", "2"],
    ]);
    expect(g.children?.find((c) => c.id === "tp")?.ports).toBeUndefined();
  });
  test("cạnh theo cổng của nó; không nêu cổng ⇒ cổng đầu; cạnh tới node lạ / vòng về chính nó bị bỏ", () => {
    const by = (id: string) => g.edges?.find((e) => e.id === id)?.sources[0];
    expect(by("ky>tb")).toBe(portId("ky", "exit:done"));
    expect(by("ky>no#t")).toBe(portId("ky", "exit:timeout:timeout"));
    expect(by("tp>gd")).toBe("tp");
    const odd = toElkGraph(
      [{ id: "a" }],
      [
        { id: "x", source: "a", target: "zz" },
        { id: "y", source: "a", target: "a" },
      ],
    );
    expect(odd.edges).toEqual([]);
  });
});

describe("layoutWithElk (ELK thật)", () => {
  test("flow demo 8 bước: đi trái → phải, gập hàng, vừa khung 1100×458 ở zoom ≥ 0.75", async () => {
    const pos = await layoutWithElk(demo.nodes, demo.edges, engine);
    const at = (id: string) => pos.get(id) as { x: number; y: number };
    expect(pos.size).toBe(8);
    expect(at("trigger").x).toBeLessThan(at("tp").x);
    expect(at("trigger").y).toBeLessThanOrEqual(at("tp").y + NODE_H); // cùng hàng đầu
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    const w = Math.max(...xs) + NODE_W - Math.min(...xs);
    const h = Math.max(...ys) + NODE_H - Math.min(...ys);
    expect(new Set(ys.map((y) => Math.round(y / NODE_H))).size).toBeGreaterThan(1); // nhiều hàng
    const zoom = Math.min((1100 - 32) / w, (458 - 32) / h);
    expect(zoom).toBeGreaterThanOrEqual(0.75);
  });

  test("thứ tự cổng từ trên xuống: Ký xong → Từ chối → Hết hạn", async () => {
    const r = await engine.layout(toElkGraph(demo.nodes, demo.edges));
    const ports = r.children?.find((c) => c.id === "ky")?.ports ?? [];
    const y = (h: string) => ports.find((p) => p.id === portId("ky", h))?.y as number;
    expect(y("exit:done")).toBeLessThan(y("exit:declined:declined,voided"));
    expect(y("exit:declined:declined,voided")).toBeLessThan(y("exit:timeout:timeout"));
  });

  test("positionsOf làm tròn; không có node ⇒ rỗng, không gọi engine", async () => {
    expect(positionsOf({ id: "r", children: [{ id: "a", x: 1.4, y: 2.6 }] }).get("a")).toEqual({
      x: 1,
      y: 3,
    });
    const never: ElkEngine = { layout: () => Promise.reject(new Error("không được gọi")) };
    expect((await layoutWithElk([], [], never)).size).toBe(0);
  });
});

test("fallbackPositions: lưới 4 node mỗi hàng, không trùng ô", () => {
  const pos = fallbackPositions(Array.from({ length: 6 }, (_, i) => ({ id: `n${i}` })));
  expect(pos.get("n0")).toEqual({ x: 0, y: 0 });
  expect(pos.get("n4")).toEqual({ x: 0, y: NODE_H + 60 });
  expect(new Set([...pos.values()].map((p) => `${p.x},${p.y}`)).size).toBe(6);
});
