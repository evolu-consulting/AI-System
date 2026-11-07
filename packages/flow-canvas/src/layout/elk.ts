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
  /** CR-125 · x10 · ràng buộc tầng: `first` = tầng đầu (Bắt đầu khi), `last` = tầng cuối (các node Kết thúc: một cột cuối, không node mồ côi ở đầu). */
  layer?: "first" | "last";
};
export type FlowEdgeIn = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};
export type FlowLayoutOptions = {
  /** Tỉ lệ rộng/cao khung nhìn để ELK gập hàng (mặc định 2.4 ≈ khung 1100×458 của editor; Dọc: 0.9). */
  aspectRatio?: number;
  /** CR-125 · x9 · hướng bố cục: `RIGHT` = Ngang (mặc định), `DOWN` = Dọc. Cổng ra ở mép phải (Ngang) / mép dưới (Dọc). */
  direction?: FlowDirection;
};

export type FlowDirection = "RIGHT" | "DOWN";

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
/** Dọc: khung hẹp / cao hơn ⇒ ELK gập thành vài cột thay vì một dải dài. */
export const DEFAULT_ASPECT_DOWN = 0.9;
/** Chỗ chừa thêm bên phải node có ≥ 2 cổng ra (nhãn "Ký xong / Từ chối / Hết hạn" nhô ra khỏi mép). */
export const PORT_LABEL_W = 48;
/** Dọc: chỗ chừa thêm PHÍA DƯỚI node có ≥ 2 cổng ra (nhãn nhô ra khỏi mép dưới). */
export const PORT_LABEL_H = 40;

/** Mép của node nơi đặt cổng ra: Ngang ⇒ phải (EAST), Dọc ⇒ dưới (SOUTH). */
export const portSide = (d: FlowDirection | undefined): "EAST" | "SOUTH" =>
  d === "DOWN" ? "SOUTH" : "EAST";

/** Kích thước THÊM của node có `ports` cổng ra theo hướng: {w, h} (Ngang chừa bên phải, Dọc chừa bên dưới). */
export const portExtent = (
  d: FlowDirection | undefined,
  ports: number,
): { w: number; h: number } =>
  ports < 2 ? { w: 0, h: 0 } : d === "DOWN" ? { w: 0, h: PORT_LABEL_H } : { w: PORT_LABEL_W, h: 0 };
export const portId = (node: string, handle: string): string => `${node}:${handle}`;

/**
 * Tuỳ chọn gốc: layered, trái → phải (hoặc trên → dưới), cạnh vuông góc. CR-125 · x10: KHÔNG gập hàng (gập làm bước sau nằm bên trái bước trước,
 * cạnh vòng chữ U) — một dải theo đúng thứ tự flow; thứ tự khai báo node + cạnh dẫn tầng và giảm cắt nhau (`considerModelOrder`).
 */
export function rootOptions(o: FlowLayoutOptions): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": o.direction ?? "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    // CR-125 · x4: đủ rộng cho node Ký số + 3 nhãn đầu ra nhô ra mép phải và mũi tên đi giữa hai tầng
    "elk.spacing.nodeNode": "56",
    // Dọc: tầng xếp theo chiều cao (cao hơn rộng) ⇒ khoảng giữa tầng nhỏ hơn để flow vừa khung; đủ chỗ cho cạnh + nhãn đầu ra
    "elk.layered.spacing.nodeNodeBetweenLayers": o.direction === "DOWN" ? "70" : "60",
    "elk.spacing.edgeNode": "32",
    "elk.layered.wrapping.strategy": "OFF",
    // node không cạnh nào (vd Kết thúc · Trả lại) vẫn xếp CÙNG đồ thị: ràng buộc tầng cuối mới có tác dụng, không bị tách thành mảnh riêng ở đầu
    "elk.separateConnectedComponents": "false",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.favorStraightEdges": "true",
    "elk.aspectRatio": String(
      o.aspectRatio ?? (o.direction === "DOWN" ? DEFAULT_ASPECT_DOWN : DEFAULT_ASPECT),
    ),
  };
}

/** Tuỳ chọn riêng của node: cổng cố định thứ tự + ràng buộc tầng đầu / cuối. */
function nodeOptions(n: FlowNodeIn): Record<string, string> {
  return {
    ...((n.ports?.length ?? 0) > 0 ? { "elk.portConstraints": "FIXED_ORDER" } : {}),
    ...(n.layer
      ? { "elk.layered.layering.layerConstraint": n.layer === "last" ? "LAST" : "FIRST" }
      : {}),
  };
}

/** Node của sơ đồ → node ELK (kích thước chừa chỗ nhãn đầu ra, cổng ở mép theo hướng). */
function toElkNode(n: FlowNodeIn, o: FlowLayoutOptions): ElkNode {
  const ports = n.ports ?? [];
  const extra = portExtent(o.direction, ports.length);
  const opts = nodeOptions(n);
  return {
    id: n.id,
    // nhãn đầu ra nhô ra mép có cổng (phải khi Ngang, dưới khi Dọc): node nhiều cổng chừa thêm chỗ để không đè node kề
    width: n.width ?? NODE_W + extra.w,
    height: n.height ?? NODE_H + extra.h,
    ...(Object.keys(opts).length > 0 ? { layoutOptions: opts } : {}),
    ...(ports.length > 0
      ? {
          ports: ports.map((p, i) => ({
            id: portId(n.id, p),
            width: 1,
            height: 1,
            layoutOptions: {
              "elk.port.side": portSide(o.direction),
              // mép dưới (SOUTH) ELK đánh số phải → trái: đảo để cổng đầu tiên nằm bên TRÁI như thứ tự trên màn hình
              "elk.port.index": String(o.direction === "DOWN" ? ports.length - 1 - i : i),
            },
          })),
        }
      : {}),
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
    children: nodes.map((n) => toElkNode(n, o)),
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
