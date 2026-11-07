// CR-125 · x9 · cạnh vẽ theo đường định tuyến NÉ node (`routing/orthogonal`) thay cho smoothstep/bezier của xyflow (vốn cắt ngang / chạy dưới node):
// bắt đầu đúng ở chấm đầu ra (toạ độ + mép do xyflow đưa), tránh hộp mọi node; nút "+" và nhãn nằm trên chính đường đã định tuyến.
import { type EdgeProps, Position, useNodes } from "@xyflow/react";
import { useMemo } from "react";
import { NODE_H, NODE_W } from "../layout/geometry";
import {
  type Pt,
  pointAt,
  polyLength,
  type Rect,
  roundedPath,
  routeEdge,
  type Side,
} from "../routing/orthogonal";

const SIDE: Record<string, Side> = {
  [Position.Left]: "left",
  [Position.Right]: "right",
  [Position.Top]: "top",
  [Position.Bottom]: "bottom",
};

export type Routed = {
  /** Chuỗi `d` SVG (góc bo). */
  path: string;
  poly: Pt[];
  /** Điểm ở GIỮA đường (theo độ dài). */
  mid: Pt;
  /** Điểm cách giữa `back` px về phía nguồn (đặt nhãn cạnh nút "+"). */
  at: (distance: number) => Pt;
};

/** Hộp mọi node của sơ đồ (toạ độ sơ đồ) — chuỗi khoá để `useMemo` không chạy lại khi node không đổi chỗ. */
function useBoxes(): { boxes: Rect[]; key: string } {
  const nodes = useNodes();
  return useMemo(() => {
    const boxes = nodes.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      w: n.measured?.width ?? n.width ?? NODE_W,
      h: n.measured?.height ?? n.height ?? NODE_H,
    }));
    return { boxes, key: boxes.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|") };
  }, [nodes]);
}

export function useRoutedPath(p: EdgeProps, radius = 10): Routed {
  const { boxes, key } = useBoxes();
  const sp = SIDE[p.sourcePosition] ?? "right";
  const tp = SIDE[p.targetPosition] ?? "left";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` thay cho `boxes` (cùng hộp ⇒ cùng đường)
  return useMemo(() => {
    const poly = routeEdge({
      from: { x: p.sourceX, y: p.sourceY },
      fromSide: sp,
      to: { x: p.targetX, y: p.targetY },
      toSide: tp,
      boxes,
    });
    const len = polyLength(poly);
    return {
      path: roundedPath(poly, radius),
      poly,
      mid: pointAt(poly, len / 2),
      at: (d: number) => pointAt(poly, len / 2 + d),
    };
  }, [p.sourceX, p.sourceY, p.targetX, p.targetY, sp, tp, key, radius]);
}
