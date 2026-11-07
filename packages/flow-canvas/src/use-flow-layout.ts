// CR-123 · u13 · hook chạy bố cục ELK (worker, tải lười) mỗi khi CẤU TRÚC đồ thị đổi (node/cạnh/cổng) — lần mở đầu, thêm / xoá / nối bước.
// Trả toạ độ tự động mới nhất (null ⇒ chưa có); vị trí người dùng kéo tay do host ghi đè lên (xem `ProcessCanvas`). Lỗi engine ⇒ null (host dùng toạ độ dự phòng).
import { useEffect, useMemo, useState } from "react";
import {
  type FlowEdgeIn,
  type FlowLayoutOptions,
  type FlowNodeIn,
  fallbackPositions,
  layoutWithElk,
} from "./layout/elk";
import { elkEngine } from "./layout/elk-engine";

export type FlowPositions = ReadonlyMap<string, { x: number; y: number }>;

export function structureKey(nodes: readonly FlowNodeIn[], edges: readonly FlowEdgeIn[]): string {
  return JSON.stringify([
    nodes.map((n) => [n.id, n.width, n.height, n.ports]),
    edges.map((e) => [e.id, e.source, e.target, e.sourceHandle ?? null]),
  ]);
}

export function useFlowLayout(
  nodes: readonly FlowNodeIn[],
  edges: readonly FlowEdgeIn[],
  o: FlowLayoutOptions = {},
): FlowPositions | null {
  const key = useMemo(() => structureKey(nodes, edges), [nodes, edges]);
  const [done, setDone] = useState<{ key: string; pos: FlowPositions } | null>(null);
  const aspect = o.aspectRatio;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` thay cho nodes/edges (cùng cấu trúc ⇒ không chạy lại)
  useEffect(() => {
    let live = true;
    void elkEngine()
      .then((engine) =>
        layoutWithElk(nodes, edges, engine, aspect === undefined ? {} : { aspectRatio: aspect }),
      )
      .then((pos) => live && setDone({ key, pos }))
      .catch(() => live && setDone({ key, pos: fallbackPositions(nodes) }));
    return () => {
      live = false;
    };
  }, [key, aspect]);
  return done?.pos ?? null;
}
