// CR-122 · tách từ ProcessCanvas (giữ file ≤ 400 dòng): các mảnh dựng sơ đồ — node "Bắt đầu khi", ô gợi ý cầu nối, cạnh vàng, nhãn "Duyệt", bóng "còn bước bên phải".
import { toEdge } from "@ai/flow-canvas";
import { NODE_H, NODE_W } from "@ai/flow-canvas/pure";
import type { Edge, Node } from "@xyflow/react";
import type { BridgeApi } from "../../hooks/use-bridge";
import { BRIDGE_W } from "./BridgeNode";
import type { StageView } from "./stage-view";
export const NODE_SIZE = { width: NODE_W, height: NODE_H } as const;

/** Cạnh tiến ra khỏi bước DLC có cổng = nhánh "Duyệt" (đi tiếp bước kế). */
export const approveEdge = (e: Edge, label: string): Edge => ({
  ...e,
  label,
  labelStyle: { fill: "var(--color-success)", fontSize: 12 },
  labelBgStyle: { fill: "var(--color-card)" },
});

export type TriggerInfo = { label: string; summary: string } | null;

/** CR-122 · U2c: node "Bắt đầu khi" (vị trí do ELK đặt), nối tới mọi giai đoạn của bước đầu. */
export function triggerPart(
  views: readonly StageView[],
  t: TriggerInfo,
  connectable = false,
): { node: Node[]; edges: Edge[] } {
  if (!t) return { node: [], edges: [] };
  const node: Node = {
    id: "trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    measured: NODE_SIZE,
    selectable: false,
    focusable: false,
    draggable: false,
    data: { ...t, connectable },
  };
  const edges = views
    .filter((v) => v.step === 0)
    .map((v) =>
      toEdge({ id: `trigger>${v.uid}`, source: "trigger", target: v.uid, kind: "forward" }),
    );
  return { node: [node], edges };
}

export type WarnEdges = readonly {
  from: string;
  to: string;
  keys: string[];
  labels: string[];
  toName: string;
}[];
export const NO_WARN: WarnEdges = [];

/** CR-122 · U2d: ô gợi ý cầu nối dưới mỗi cạnh vàng; có đề xuất ⇒ thêm cạnh nét đứt qua ô (xem trước node Ghi giá trị mờ). */
export function bridgePart(
  nodes: readonly Node[],
  warn: WarnEdges,
  api: BridgeApi | undefined,
): { node: Node[]; edges: Edge[] } {
  if (!api) return { node: [], edges: [] };
  const out: { node: Node[]; edges: Edge[] } = { node: [], edges: [] };
  for (const w of warn) {
    const a = nodes.find((n) => n.id === w.from);
    const b = nodes.find((n) => n.id === w.to);
    if (!a || !b) continue;
    const id = `bridge:${w.from}>${w.to}`;
    const ok = api.ui(w).kind === "ok";
    out.node.push({
      id,
      type: "bridge",
      position: {
        // ô đặt lệch về bên trái cạnh để câu không bị mép phải khung cắt
        x: (a.position.x + NODE_W + b.position.x) / 2 - BRIDGE_W * 0.8,
        y: Math.max(a.position.y, b.position.y) + NODE_H + 28,
      },
      measured: { width: BRIDGE_W, height: ok ? 150 : 76 },
      selectable: false,
      focusable: false,
      draggable: false,
      data: { from: w.from, to: w.to, keys: w.keys, labels: w.labels, toName: w.toName },
    });
    if (ok)
      for (const [s, t] of [
        [w.from, id],
        [id, w.to],
      ] as const)
        out.edges.push({
          ...toEdge({ id: `${s}>${t}`, source: s, target: t, kind: "forward" }),
          style: { strokeDasharray: "5 4" },
        });
  }
  return out;
}

/** CR-122 · FR-26 · cạnh vàng: bước sau cần đầu vào mà bước trước không có (nét vàng + nhãn, không chỉ màu). */
export function warnStyle(edges: Edge[], warn: WarnEdges): Edge[] {
  if (warn.length === 0) return edges;
  const bad = new Set(warn.map((w) => `${w.from}>${w.to}`));
  return edges.map((e) =>
    bad.has(`${e.source}>${e.target}`)
      ? {
          ...e,
          label: "⚠",
          style: { stroke: "var(--color-warning)", strokeWidth: 2.5 },
          labelStyle: { fill: "var(--color-warning)", fontSize: 12 },
          labelBgStyle: { fill: "var(--color-card)" },
        }
      : e,
  );
}

/** CR-123 · p25: chỉ cạnh nối HAI giai đoạn (tiến thường hoặc Đúng/Sai) chọn / nối lại đầu đích / xoá được; cạnh còn lại (quay lại, nút gộp, cầu nối, bắt đầu) thì không. */
export function editableEdges(edges: Edge[], uids: ReadonlySet<string>): Edge[] {
  return edges.map((e0) => {
    let e = e0;
    const side = (e.data as { side?: string } | undefined)?.side;
    // cổng Đúng/Sai ở node đã có nhãn chữ (IfPort) ⇒ cạnh không in nhãn lần nữa
    if (side) e = { ...e, data: { ...e.data, noLabel: true } };
    const plain =
      uids.has(e.source) &&
      uids.has(e.target) &&
      (e.type === undefined || e.type === "forward" || (e.type === "branch" && !!side));
    const exit = (e.data as { exit?: boolean } | undefined)?.exit === true; // đầu ra ô module: nối lại được, chưa chọn/xoá riêng
    return plain
      ? { ...e, selectable: !exit, reconnectable: "target" as const }
      : { ...e, selectable: false, reconnectable: false };
  });
}
