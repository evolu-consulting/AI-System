// CR-123 · u13 · bố cục sơ đồ bằng ELK `layered` (ADR-0035): cạnh đi trái → phải, đầu ra nhiều nhánh (Ký số: Ký xong / Từ chối / Hết hạn, Nếu: Đúng / Sai)
// là CỔNG ở mép phải theo thứ tự cố định, cạnh đi vuông góc, flow dài được GẬP thành nhiều hàng cho vừa khung. Phần dưới là bộ chuyển thuần
// (đồ thị → đầu vào ELK → toạ độ) để test không cần worker; chạy thật qua `layoutWithElk` (engine tiêm vào, mặc định tải lười `elk-engine.ts`).
import { NODE_H, NODE_W } from "./geometry";

export type FlowNodeIn = {
  id: string;
  width?: number;
  height?: number;
  /** Cổng ra ở mép phải, THEO THỨ TỰ từ trên xuống (id = `sourceHandle` của cạnh). */
  ports?: readonly string[];
};
export type FlowEdgeIn = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};
export type FlowLayoutOptions = {
  /** Tỉ lệ rộng/cao khung nhìn để ELK gập hàng (mặc định 2.4 ≈ khung 1100×458 của editor). */
  aspectRatio?: number;
};

export type ElkPort = {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  layoutOptions: Record<string, string>;
};
export type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  ports?: ElkPort[];
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
};
export type ElkEngine = { layout: (g: ElkNode) => Promise<ElkNode> };

export const DEFAULT_ASPECT = 2.4;
/** Chỗ chừa thêm bên phải node có ≥ 2 cổng ra (nhãn "Ký xong / Từ chối / Hết hạn" nhô ra khỏi mép). */
export const PORT_LABEL_W = 48;
export const portId = (node: string, handle: string): string => `${node}:${handle}`;

/** Tuỳ chọn gốc: layered, trái → phải, cạnh vuông góc, gập hàng đa cạnh theo tỉ lệ khung. */
export function rootOptions(o: FlowLayoutOptions): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    // CR-125 · x4: đủ rộng cho node Ký số + 3 nhãn đầu ra nhô ra mép phải và mũi tên đi giữa hai tầng
    "elk.spacing.nodeNode": "56",
    "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    "elk.spacing.edgeNode": "32",
    "elk.layered.wrapping.strategy": "MULTI_EDGE",
    "elk.aspectRatio": String(o.aspectRatio ?? DEFAULT_ASPECT),
  };
}

/** Đồ thị sơ đồ → đầu vào ELK. Cạnh không nêu cổng mà nguồn có cổng ⇒ cổng đầu tiên (đầu ra "đi tiếp"). */
export function toElkGraph(
  nodes: readonly FlowNodeIn[],
  edges: readonly FlowEdgeIn[],
  o: FlowLayoutOptions = {},
): ElkNode {
  const ids = new Set(nodes.map((n) => n.id));
  const portsOf = new Map(nodes.map((n) => [n.id, n.ports ?? []]));
  return {
    id: "root",
    layoutOptions: rootOptions(o),
    children: nodes.map((n) => {
      const ports = n.ports ?? [];
      return {
        id: n.id,
        // nhãn đầu ra nhô ra mép phải: node nhiều cổng chừa thêm chỗ bên phải để không đè node kề
        width: n.width ?? NODE_W + (ports.length > 1 ? PORT_LABEL_W : 0),
        height: n.height ?? NODE_H,
        ...(ports.length > 0
          ? {
              layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
              ports: ports.map((p, i) => ({
                id: portId(n.id, p),
                width: 1,
                height: 1,
                layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(i) },
              })),
            }
          : {}),
      };
    }),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      .map((e) => {
        const ports = portsOf.get(e.source) ?? [];
        const handle = e.sourceHandle && ports.includes(e.sourceHandle) ? e.sourceHandle : ports[0];
        return {
          id: e.id,
          sources: [handle === undefined ? e.source : portId(e.source, handle)],
          targets: [e.target],
        };
      }),
  };
}

/** Kết quả ELK → toạ độ góc trên-trái của từng node (xyflow dùng cùng quy ước). */
export function positionsOf(result: ElkNode): Map<string, { x: number; y: number }> {
  return new Map(
    (result.children ?? []).map((c) => [
      c.id,
      { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) },
    ]),
  );
}

/** Chạy bố cục; `engine` tiêm vào (test dùng ELK đồng bộ, trình duyệt dùng worker tải lười). */
export async function layoutWithElk(
  nodes: readonly FlowNodeIn[],
  edges: readonly FlowEdgeIn[],
  engine: ElkEngine,
  o: FlowLayoutOptions = {},
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();
  return positionsOf(await engine.layout(toElkGraph(nodes, edges, o)));
}

/** Toạ độ DỰ PHÒNG khi engine ELK không chạy được (worker bị chặn…): lưới 4 node mỗi hàng theo thứ tự đã cho — canvas không bao giờ trống. */
export function fallbackPositions(
  nodes: readonly FlowNodeIn[],
  perRow = 4,
): Map<string, { x: number; y: number }> {
  return new Map(
    nodes.map((n, i) => [
      n.id,
      { x: (i % perRow) * (NODE_W + 60), y: Math.floor(i / perRow) * (NODE_H + 60) },
    ]),
  );
}
