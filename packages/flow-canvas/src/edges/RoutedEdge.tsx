// CR-125 · x9 · cạnh thường (đầu ra Từ chối / Hết hạn của node module, "Bắt đầu khi"…) vẽ theo đường định tuyến né node (không có nút "+").
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { useRoutedPath } from "./use-route";

function RoutedEdgeImpl(p: EdgeProps) {
  const { path, mid } = useRoutedPath(p, 12);
  return (
    <BaseEdge
      id={p.id}
      path={path}
      markerEnd={p.markerEnd}
      style={p.style}
      interactionWidth={20}
      label={p.label}
      labelX={mid.x}
      labelY={mid.y}
      labelStyle={p.labelStyle}
      labelBgStyle={p.labelBgStyle}
      labelShowBg={p.labelShowBg}
    />
  );
}

export const RoutedEdge = memo(RoutedEdgeImpl);
