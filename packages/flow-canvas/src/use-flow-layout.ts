// CR-123 · u13 · hook chạy bố cục ELK (worker, tải lười) mỗi khi CẤU TRÚC đồ thị đổi (node/cạnh/cổng) — lần mở đầu, thêm / xoá / nối bước.
// Trả toạ độ tự động mới nhất (null ⇒ chưa có); vị trí người dùng kéo tay do host ghi đè lên (xem `ProcessCanvas`). Lỗi engine ⇒ null (host dùng toạ độ dự phòng).
import { useEffect, useMemo, useState } from "react";
import {
  type FlowDirection,
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
    nodes.map((n) => [n.id, n.width, n.height, n.ports, n.layer]),
    edges.map((e) => [e.id, e.source, e.target, e.sourceHandle ?? null]),
  ]);
}

export function useFlowLayout(
  nodes: readonly FlowNodeIn[],
  edges: readonly FlowEdgeIn[],
  o: FlowLayoutOptions = {},
): FlowPositions | null {
  const key = useMemo(
    () => `${o.direction ?? "RIGHT"}|${structureKey(nodes, edges)}`,
    [nodes, edges, o.direction],
  );
  const [done, setDone] = useState<{
    key: string;
    pos: FlowPositions;
    dir: FlowDirection;
  } | null>(null);
  const aspect = o.aspectRatio;
  const direction = o.direction;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` thay cho nodes/edges (cùng cấu trúc ⇒ không chạy lại)
  useEffect(() => {
    let live = true;
    void elkEngine()
      .then((engine) =>
        layoutWithElk(nodes, edges, engine, {
          ...(aspect === undefined ? {} : { aspectRatio: aspect }),
          ...(direction === undefined ? {} : { direction }),
        }),
      )
      .then((pos) => live && setDone({ key, pos, dir: direction ?? "RIGHT" }))
      .catch(
        () => live && setDone({ key, pos: fallbackPositions(nodes), dir: direction ?? "RIGHT" }),
      );
    return () => {
      live = false;
    };
  }, [key, aspect, direction]);
  // đổi hướng ⇒ toạ độ cũ không dùng được: chưa có toạ độ mới ⇒ null (host chờ, rồi fit lại khi có)
  return done && done.dir === (direction ?? "RIGHT") ? done.pos : null;
}
